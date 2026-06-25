import 'package:cloud_functions/cloud_functions.dart';

/// 운영자에게 보여줄 pending 안내자 신청 한 건.
///
/// 승인/거절 callable은 applicationId가 아니라 신청자 [userId]를 입력으로 받으므로,
/// 목록 항목은 userId를 반드시 보유한다. [applicationId]는 화면 표시/식별용.
class PendingApplication {
  const PendingApplication({required this.applicationId, required this.userId});

  final String applicationId;
  final String userId;
}

/// 운영자 전용 Cloud Functions callable(listPendingGuideApplications,
/// approveGuide, rejectGuide)을 감싸는 service 계층.
///
/// 사용자 관점의 [GuideService]와 분리한다 — 백엔드도 admin 모듈을 user 모듈과
/// 분리(assertOperator)하며, 운영자 권한이 없으면 호출은 permission-denied로 실패한다.
///
/// 백엔드 functions는 리전을 지정하지 않아 기본 리전(us-central1)에 배포되므로,
/// 여기서도 [FirebaseFunctions.instance](기본 리전)를 사용한다.
class AdminService {
  /// [functions]를 주입하면 그것을, 없으면 기본 인스턴스를 사용한다(테스트용 주입).
  AdminService([this._functions]);

  final FirebaseFunctions? _functions;

  /// FirebaseFunctions 인스턴스. 생성자에서 즉시 접근하면 Firebase 초기화 전
  /// 환경(위젯 테스트 등)에서 실패할 수 있어, 실제 호출 시점에 지연 평가한다.
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
  /// null/빈 문자열이면 요청에서 생략한다. 운영자 권한이 없으면 permission-denied로
  /// 실패한다(권한 검사는 백엔드 assertOperator에 위임).
  Future<void> hideArchiveItem({required String itemId, String? reason}) async {
    final trimmed = reason?.trim();
    final hasReason = trimmed != null && trimmed.isNotEmpty;
    final callable = _fn.httpsCallable('hideArchiveItem');
    await callable.call<Map<String, dynamic>>({
      'itemId': itemId,
      'reason': ?(hasReason ? trimmed : null),
    });
  }
}
