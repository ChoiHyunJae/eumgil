import 'package:cloud_functions/cloud_functions.dart';

/// 매칭 검색 결과에 표시할 안내자 후보 한 건.
///
/// 백엔드 GuideCandidate(guide: UserProfile, distanceM, isNewGuide)에서 화면에
/// 필요한 최소 필드만 추린다. UserProfile에 이름 필드가 없어 [displayName]은
/// 현재 guideId로 fallback한다(전화번호 등 민감정보는 노출하지 않음).
class GuideCandidateSummary {
  const GuideCandidateSummary({
    required this.guideId,
    required this.displayName,
    required this.distanceM,
    required this.isNewGuide,
  });

  final String guideId;
  final String displayName;
  final double distanceM;
  final bool isNewGuide;
}

/// 안내자가 받은 Requested 동행 요청 한 건.
///
/// 백엔드 listReceivedEscortRequests의 항목과 1:1 대응한다. 시각은 ISO 문자열로
/// 전달되며 여기서 DateTime으로 파싱해 보관한다.
class ReceivedEscortRequestSummary {
  const ReceivedEscortRequestSummary({
    required this.escortId,
    required this.travelerId,
    required this.requestedAt,
    required this.requestExpiresAt,
  });

  final String escortId;
  final String travelerId;
  final DateTime requestedAt;
  final DateTime requestExpiresAt;
}

/// 매칭 Cloud Functions callable(searchGuides, requestEscort)을 감싸는 service.
///
/// 기존 service들과 동일하게 [FirebaseFunctions]를 주입 가능하게 하고, 인스턴스는
/// 호출 시점에 지연 평가한다(테스트 환경 호환). 백엔드는 기본 리전(us-central1)에
/// 배포되므로 기본 인스턴스를 사용한다.
class MatchingService {
  /// [functions]를 주입하면 그것을, 없으면 기본 인스턴스를 사용한다(테스트용 주입).
  MatchingService([this._functions]);

  final FirebaseFunctions? _functions;

  FirebaseFunctions get _fn => _functions ?? FirebaseFunctions.instance;

  /// 입력 좌표 기준 반경 내 승인 안내자를 거리 오름차순으로 조회한다.
  Future<List<GuideCandidateSummary>> searchGuides({
    required double lat,
    required double lng,
  }) async {
    final callable = _fn.httpsCallable('searchGuides');
    final result = await callable.call<Map<String, dynamic>>({
      'location': {'lat': lat, 'lng': lng},
    });
    final raw = (result.data['candidates'] as List<dynamic>?) ?? <dynamic>[];
    return raw.map((dynamic e) => Map<String, dynamic>.from(e as Map)).map((
      candidate,
    ) {
      final guide = Map<String, dynamic>.from(candidate['guide'] as Map);
      final guideId = guide['id'] as String? ?? '';
      return GuideCandidateSummary(
        guideId: guideId,
        displayName: guideId,
        distanceM: (candidate['distanceM'] as num?)?.toDouble() ?? 0,
        isNewGuide: candidate['isNewGuide'] as bool? ?? false,
      );
    }).toList();
  }

  /// 해당 안내자에게 동행 요청을 생성한다.
  Future<void> requestEscort({required String guideId}) async {
    final callable = _fn.httpsCallable('requestEscort');
    await callable.call<Map<String, dynamic>>({'guideId': guideId});
  }

  /// 본인이 안내자인 Requested(미만료) 동행 요청 목록을 조회한다.
  Future<List<ReceivedEscortRequestSummary>>
  listReceivedEscortRequests() async {
    final callable = _fn.httpsCallable('listReceivedEscortRequests');
    final result = await callable.call<Map<String, dynamic>>();
    final raw = (result.data['requests'] as List<dynamic>?) ?? <dynamic>[];
    return raw.map((dynamic e) => Map<String, dynamic>.from(e as Map)).map((r) {
      return ReceivedEscortRequestSummary(
        escortId: r['escortId'] as String? ?? '',
        travelerId: r['travelerId'] as String? ?? '',
        requestedAt: DateTime.parse(r['requestedAt'] as String),
        requestExpiresAt: DateTime.parse(r['requestExpiresAt'] as String),
      );
    }).toList();
  }

  /// 동행 요청을 수락/거절한다. 수락 시 만남 위치/시간은 필수다.
  Future<void> respondToRequest({
    required String escortId,
    required bool accept,
    double? meetingLat,
    double? meetingLng,
    String? meetingTime,
  }) async {
    final callable = _fn.httpsCallable('respondToRequest');
    await callable.call<Map<String, dynamic>>({
      'escortId': escortId,
      'accept': accept,
      if (accept) 'meetingLocation': {'lat': meetingLat, 'lng': meetingLng},
      if (accept) 'meetingTime': meetingTime,
    });
  }
}
