import 'package:cloud_functions/cloud_functions.dart';

/// 매칭 검색 결과에 표시할 안내자 후보 한 건.
class GuideCandidateSummary {
  const GuideCandidateSummary({
    required this.guideId,
    required this.displayName,
    required this.distanceM,
    required this.isNewGuide,
    this.bio,
    this.photoUrl,
    this.interests,
    this.averageSatisfaction,
    this.completedEscortCount = 0,
  });

  final String guideId;
  final String displayName;
  final double distanceM;
  final bool isNewGuide;

  /// 안내자 자기소개. 없으면 null.
  final String? bio;

  /// 프로필 사진 URL. 없으면 기본 아바타를 사용한다.
  final String? photoUrl;

  /// 관심 분야 목록. 없으면 null.
  final List<String>? interests;

  /// 평균 만족도(1~5). 아직 없으면 null.
  final double? averageSatisfaction;

  /// 완료한 동행 수.
  final int completedEscortCount;
}

/// 안내자가 받은 Requested 동행 요청 한 건.
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

/// 매칭 Cloud Functions callable을 감싸는 service.
class MatchingService {
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
    return raw
        .map((dynamic e) => Map<String, dynamic>.from(e as Map))
        .map((candidate) {
      final guide =
          Map<String, dynamic>.from(candidate['guide'] as Map);
      final guideId = guide['id'] as String? ?? '';
      final stats = guide['guideStats'] == null
          ? null
          : Map<String, dynamic>.from(guide['guideStats'] as Map);
      final interestsRaw = guide['interests'] as List<dynamic>?;
      return GuideCandidateSummary(
        guideId: guideId,
        displayName: guideId,
        distanceM: (candidate['distanceM'] as num?)?.toDouble() ?? 0,
        isNewGuide: candidate['isNewGuide'] as bool? ?? false,
        bio: guide['bio'] as String?,
        photoUrl: guide['photoUrl'] as String?,
        interests: interestsRaw?.map((e) => e.toString()).toList(),
        averageSatisfaction:
            (stats?['averageSatisfaction'] as num?)?.toDouble(),
        completedEscortCount:
            (stats?['completedEscortCount'] as num?)?.toInt() ?? 0,
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
    final raw =
        (result.data['requests'] as List<dynamic>?) ?? <dynamic>[];
    return raw
        .map((dynamic e) => Map<String, dynamic>.from(e as Map))
        .map((r) {
      return ReceivedEscortRequestSummary(
        escortId: r['escortId'] as String? ?? '',
        travelerId: r['travelerId'] as String? ?? '',
        requestedAt: DateTime.parse(r['requestedAt'] as String),
        requestExpiresAt:
            DateTime.parse(r['requestExpiresAt'] as String),
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
