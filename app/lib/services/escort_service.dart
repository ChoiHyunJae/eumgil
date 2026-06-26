import 'package:cloud_functions/cloud_functions.dart';

/// 진행 중 동행 한 건의 최소 정보(MyEscortScreen 표시용).
///
/// 백엔드 listMyEscorts의 항목과 1:1 대응한다. meetingTime은 ISO 문자열로
/// 전달되며 여기서 DateTime으로 파싱한다(미확정이면 null).
class MyEscortSummary {
  const MyEscortSummary({
    required this.escortId,
    required this.guideId,
    required this.travelerId,
    required this.status,
    this.meetingTime,
  });

  final String escortId;
  final String guideId;
  final String travelerId;
  final String status;
  final DateTime? meetingTime;
}

/// escort 생명주기 Cloud Functions callable(listMyEscorts, cancelEscort)을
/// 감싸는 service. 기존 service들과 동일하게 [FirebaseFunctions]를 주입 가능하게
/// 하고, 인스턴스는 호출 시점에 지연 평가한다. 백엔드는 기본 리전(us-central1).
class EscortService {
  /// [functions]를 주입하면 그것을, 없으면 기본 인스턴스를 사용한다(테스트용 주입).
  EscortService([this._functions]);

  final FirebaseFunctions? _functions;

  FirebaseFunctions get _fn => _functions ?? FirebaseFunctions.instance;

  /// 현재 로그인 사용자가 당사자인 진행 중 동행 목록을 조회한다.
  Future<List<MyEscortSummary>> listMyEscorts() async {
    final callable = _fn.httpsCallable('listMyEscorts');
    final result = await callable.call<Map<String, dynamic>>();
    final raw = (result.data['escorts'] as List<dynamic>?) ?? <dynamic>[];
    return raw.map((dynamic e) => Map<String, dynamic>.from(e as Map)).map((m) {
      final meetingTime = m['meetingTime'] as String?;
      return MyEscortSummary(
        escortId: m['escortId'] as String? ?? '',
        guideId: m['guideId'] as String? ?? '',
        travelerId: m['travelerId'] as String? ?? '',
        status: m['status'] as String? ?? '',
        meetingTime: (meetingTime != null && meetingTime.isNotEmpty)
            ? DateTime.parse(meetingTime)
            : null,
      );
    }).toList();
  }

  /// 동행을 시작 전 취소한다(당사자만 가능).
  Future<void> cancelEscort({required String escortId}) async {
    final callable = _fn.httpsCallable('cancelEscort');
    await callable.call<Map<String, dynamic>>({'escortId': escortId});
  }

  /// 만남 장소 근처(50m 이내)에서 "만났어요"를 확인한다.
  /// 양쪽 모두 확인되면 백엔드가 InProgress로 전환한다. 반환은 전이 후 상태.
  Future<String> confirmMeeting({
    required String escortId,
    required double lat,
    required double lng,
  }) async {
    final callable = _fn.httpsCallable('confirmMeeting');
    final result = await callable.call<Map<String, dynamic>>({
      'escortId': escortId,
      'location': {'lat': lat, 'lng': lng},
    });
    return result.data['status'] as String? ?? '';
  }
}
