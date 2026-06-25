import 'package:cloud_functions/cloud_functions.dart';

/// 안내자 신청 상태. 백엔드 getMyGuideApplicationStatus의 status 값과 1:1 대응한다.
///
/// - [none]: 신청 이력 없음 → 신청 가능
/// - [pending]: 신청 후 운영자 검토 대기 중
/// - [approved]: 안내자 승인됨 → 동네 지식 등록 가능
/// - [rejected]: 신청 거절됨 → 재신청 가능
enum GuideApplicationViewStatus { none, pending, approved, rejected }

/// getMyGuideApplicationStatus 호출 결과.
class GuideStatusResult {
  const GuideStatusResult({required this.status, this.applicationId});

  final GuideApplicationViewStatus status;

  /// 상태를 결정한 신청 문서 id. none/플래그 기반 approved면 null일 수 있다.
  final String? applicationId;
}

/// Cloud Functions callable(getMyGuideApplicationStatus, applyForGuide)을
/// 감싸는 최소 service 계층.
///
/// 백엔드 functions는 리전을 지정하지 않아 기본 리전(us-central1)에 배포되므로,
/// 여기서도 [FirebaseFunctions.instance](기본 리전)를 사용한다.
class GuideService {
  /// [functions]를 주입하면 그것을, 없으면 기본 인스턴스를 사용한다(테스트용 주입).
  GuideService([this._functions]);

  final FirebaseFunctions? _functions;

  /// FirebaseFunctions 인스턴스. 생성자에서 즉시 접근하면 Firebase 초기화 전
  /// 환경(위젯 테스트 등)에서 실패할 수 있어, 실제 호출 시점에 지연 평가한다.
  FirebaseFunctions get _fn => _functions ?? FirebaseFunctions.instance;

  /// 본인의 안내자 신청 상태를 조회한다.
  Future<GuideStatusResult> getMyStatus() async {
    final callable = _fn.httpsCallable('getMyGuideApplicationStatus');
    final result = await callable.call<Map<String, dynamic>>();
    final data = result.data;
    return GuideStatusResult(
      status: _parseStatus(data['status'] as String?),
      applicationId: data['applicationId'] as String?,
    );
  }

  /// 본인 계정으로 안내자 신청을 제출한다.
  Future<void> applyForGuide() async {
    final callable = _fn.httpsCallable('applyForGuide');
    await callable.call<Map<String, dynamic>>();
  }

  /// 백엔드 status 문자열을 enum으로 변환한다. 알 수 없는 값은 none으로 처리한다.
  GuideApplicationViewStatus _parseStatus(String? raw) {
    switch (raw) {
      case 'pending':
        return GuideApplicationViewStatus.pending;
      case 'approved':
        return GuideApplicationViewStatus.approved;
      case 'rejected':
        return GuideApplicationViewStatus.rejected;
      case 'none':
      default:
        return GuideApplicationViewStatus.none;
    }
  }
}
