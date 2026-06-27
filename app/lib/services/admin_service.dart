import 'package:cloud_functions/cloud_functions.dart';

/// 운영자에게 보여줄 pending 안내자 신청 한 건.
///
/// 승인/거절 callable은 applicationId가 아니라 신청자 [userId]를 입력으로 받으므로
/// 목록 항목은 userId를 반드시 보유한다. [applicationId]는 화면 표시/식별용.
class PendingApplication {
  const PendingApplication({required this.applicationId, required this.userId});

  final String applicationId;
  final String userId;
}

/// 운영자 검토 목록에 표시할 신고된 동네 지식 한 건.
class ReportedArchiveItem {
  const ReportedArchiveItem({
    required this.itemId,
    required this.authorId,
    required this.category,
    required this.body,
    required this.reportCount,
    required this.hidden,
    this.dongLabel,
  });

  final String itemId;
  final String authorId;

  /// 백엔드 category 문자열(PLACE/WALK/OTHER).
  final String category;

  /// 본문. aiSummary가 있으면 그것을, 없으면 voiceTranscript를 사용한다.
  final String body;

  final int reportCount;
  final bool hidden;
  final String? dongLabel;
}

/// 승인된 안내자 목록에 표시할 한 건(자격 상실 처리 대상).
class ApprovedGuide {
  const ApprovedGuide({
    required this.userId,
    this.phoneNumber,
    this.residenceYears,
    this.interests,
  });

  final String userId;
  final String? phoneNumber;
  final int? residenceYears;
  final List<String>? interests;
}

/// 운영자 전용 Cloud Functions callable(listPendingGuideApplications,
/// approveGuide, rejectGuide)을 감싸는 service 계층.
///
/// 사용자 관점의 [GuideService]와 분리한다. 백엔드도 admin 모듈을 user 모듈과
/// 분리(assertOperator)하며, 운영자 권한이 없으면 호출은 permission-denied로 실패한다.
///
/// 백엔드 functions는 리전을 지정하지 않아 기본 리전(us-central1)에 배포되므로
/// 여기서도 [FirebaseFunctions.instance](기본 리전)를 사용한다.
class AdminService {
  /// [functions]를 주입하면 그것을, 없으면 기본 인스턴스를 사용한다(테스트용 주입).
  AdminService([this._functions]);

  final FirebaseFunctions? _functions;

  /// FirebaseFunctions 인스턴스. 생성자에서 즉시 접근하면 Firebase 초기화 전
  /// 환경(위젯 테스트 등)에서 실패할 수 있어, 실제 호출 시점까지 지연 평가한다.
  FirebaseFunctions get _fn => _functions ?? FirebaseFunctions.instance;

  /// 처리 대기 중인(pending) 안내자 신청 목록을 조회한다.
  Future<List<PendingApplication>> listPending() async {
    final callable = _fn.httpsCallable('listPendingGuideApplications');
    final result = await callable.call<Map<String, dynamic>>();
    final raw = (result.data['applications'] as List<dynamic>?) ?? <dynamic>[];
    return raw
        .map((dynamic e) => Map<String, dynamic>.from(e as Map))
        .map(
          (item) => PendingApplication(
            applicationId: item['id'] as String? ?? '',
            userId: item['userId'] as String? ?? '',
          ),
        )
        .toList();
  }

  /// 해당 사용자의 안내자 신청을 승인한다.
  Future<void> approve(String userId) async {
    final callable = _fn.httpsCallable('approveGuide');
    await callable.call<Map<String, dynamic>>({'userId': userId});
  }

  /// 해당 사용자의 안내자 신청을 거절한다.
  Future<void> reject(String userId) async {
    final callable = _fn.httpsCallable('rejectGuide');
    await callable.call<Map<String, dynamic>>({'userId': userId});
  }

  /// 신고된 동네 지식을 숨김 처리한다.
  ///
  /// 백엔드는 [itemId](필수)만 사용하며 [reason]은 선택값이다. reason이
  /// null/빈 문자이면 요청에서 생략한다. 운영자 권한이 없으면 permission-denied로
  /// 실패한다(권한 검사는 백엔드 assertOperator에 맡김).
  Future<void> hideArchiveItem({required String itemId, String? reason}) async {
    final trimmed = reason?.trim();
    final hasReason = trimmed != null && trimmed.isNotEmpty;
    final callable = _fn.httpsCallable('hideArchiveItem');
    await callable.call<Map<String, dynamic>>({
      'itemId': itemId,
      'reason': hasReason ? trimmed : null,
    });
  }

  /// 신고된(reportCount>0) 동네 지식 검토 목록을 조회한다.
  /// [includeHidden]이 true면 이미 숨김 처리된 항목도 포함한다.
  Future<List<ReportedArchiveItem>> listReportedArchiveItems({
    bool includeHidden = false,
  }) async {
    final callable = _fn.httpsCallable('listReportedArchiveItems');
    final result = await callable.call<Map<String, dynamic>>({
      'includeHidden': includeHidden,
    });
    final raw = (result.data['items'] as List<dynamic>?) ?? <dynamic>[];
    return raw.map((dynamic e) => Map<String, dynamic>.from(e as Map)).map((m) {
      final summary = (m['aiSummary'] as String?)?.trim();
      final transcript = m['voiceTranscript'] as String? ?? '';
      return ReportedArchiveItem(
        itemId: m['id'] as String? ?? '',
        authorId: m['authorId'] as String? ?? '',
        category: m['category'] as String? ?? '',
        body: (summary != null && summary.isNotEmpty) ? summary : transcript,
        reportCount: (m['reportCount'] as num?)?.toInt() ?? 0,
        hidden: m['hidden'] == true,
        dongLabel: m['dongLabel'] as String?,
      );
    }).toList();
  }

  /// 운영자 권한으로 신고된 동네 지식을 영구 삭제한다(안내자 본인 삭제와 별개).
  Future<void> deleteArchiveItem({
    required String itemId,
    String? reason,
  }) async {
    final payload = <String, dynamic>{'itemId': itemId};
    final trimmed = reason?.trim();
    if (trimmed != null && trimmed.isNotEmpty) {
      payload['reason'] = trimmed;
    }
    final callable = _fn.httpsCallable('deleteArchiveItemAsAdmin');
    await callable.call<Map<String, dynamic>>(payload);
  }

  /// 승인된 안내자 목록을 조회한다(자격 상실 처리 대상).
  Future<List<ApprovedGuide>> listApprovedGuides() async {
    final callable = _fn.httpsCallable('listApprovedGuides');
    final result = await callable.call<Map<String, dynamic>>();
    final raw = (result.data['guides'] as List<dynamic>?) ?? <dynamic>[];
    return raw.map((dynamic e) => Map<String, dynamic>.from(e as Map)).map((m) {
      final interestsRaw = m['interests'] as List<dynamic>?;
      return ApprovedGuide(
        userId: m['userId'] as String? ?? '',
        phoneNumber: m['phoneNumber'] as String?,
        residenceYears: (m['residenceYears'] as num?)?.toInt(),
        interests: interestsRaw?.map((e) => e.toString()).toList(),
      );
    }).toList();
  }
}
