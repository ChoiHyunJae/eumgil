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

/// 만남 시간/장소 재제안("이 시간은 안 되니 이 시간은 어떠세요") 정보.
class CounterProposalSummary {
  const CounterProposalSummary({
    required this.proposedBy,
    required this.proposedAt,
    required this.meetingTime,
    required this.meetingLat,
    required this.meetingLng,
    this.meetingLocationLabel,
    this.message,
  });

  /// 'guide' 또는 'traveler'. 이 제안을 보낸 쪽.
  final String proposedBy;
  final DateTime proposedAt;
  final DateTime meetingTime;
  final double meetingLat;
  final double meetingLng;
  final String? meetingLocationLabel;
  final String? message;

  static CounterProposalSummary? fromMap(Map<String, dynamic>? map) {
    if (map == null) return null;
    final loc = Map<String, dynamic>.from(map['meetingLocation'] as Map);
    return CounterProposalSummary(
      proposedBy: map['proposedBy'] as String? ?? '',
      proposedAt: DateTime.parse(map['proposedAt'] as String),
      meetingTime: DateTime.parse(map['meetingTime'] as String),
      meetingLat: (loc['lat'] as num).toDouble(),
      meetingLng: (loc['lng'] as num).toDouble(),
      meetingLocationLabel: map['meetingLocationLabel'] as String?,
      message: map['message'] as String?,
    );
  }
}

/// 안내자가 받은 Requested 동행 요청 한 건.
class ReceivedEscortRequestSummary {
  const ReceivedEscortRequestSummary({
    required this.escortId,
    required this.travelerId,
    required this.requestedAt,
    required this.requestExpiresAt,
    this.requestedArchiveItemId,
    this.proposedMeetingTime,
    this.counterProposal,
  });

  final String escortId;
  final String travelerId;
  final DateTime requestedAt;
  final DateTime requestExpiresAt;

  /// 탐방자가 특정 동네 지식을 보고 요청한 경우 그 문서 id. 없으면 null.
  final String? requestedArchiveItemId;

  /// 탐방자가 요청 시 미리 제안한 만남 시간. 없으면 null.
  final DateTime? proposedMeetingTime;

  /// 응답 대기 중인 재제안(상대방이 새 시간/장소를 제시한 상태). 없으면 null.
  final CounterProposalSummary? counterProposal;
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
      final guide = Map<String, dynamic>.from(candidate['guide'] as Map);
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
  ///
  /// [archiveItemId]를 주면 탐방자가 특정 동네 지식을 보고 요청한 것으로
  /// 기록된다(안내자에게 어떤 장소/이야기에 관심이 있는지 전달).
  /// [proposedMeetingTime]을 주면 탐방자가 원하는 만남 시간을 미리 제안한다.
  Future<void> requestEscort({
    required String guideId,
    String? archiveItemId,
    DateTime? proposedMeetingTime,
  }) async {
    final payload = <String, dynamic>{'guideId': guideId};
    if (archiveItemId != null) {
      payload['archiveItemId'] = archiveItemId;
    }
    if (proposedMeetingTime != null) {
      payload['proposedMeetingTime'] =
          proposedMeetingTime.toUtc().toIso8601String();
    }
    final callable = _fn.httpsCallable('requestEscort');
    await callable.call<Map<String, dynamic>>(payload);
  }

  /// 본인이 안내자인 Requested(미만료) 동행 요청 목록을 조회한다.
  Future<List<ReceivedEscortRequestSummary>>
      listReceivedEscortRequests() async {
    final callable = _fn.httpsCallable('listReceivedEscortRequests');
    final result = await callable.call<Map<String, dynamic>>();
    final raw = (result.data['requests'] as List<dynamic>?) ?? <dynamic>[];
    return raw
        .map((dynamic e) => Map<String, dynamic>.from(e as Map))
        .map((r) {
      final proposedTime = r['proposedMeetingTime'] as String?;
      final counterMap = r['counterProposal'] == null
          ? null
          : Map<String, dynamic>.from(r['counterProposal'] as Map);
      return ReceivedEscortRequestSummary(
        escortId: r['escortId'] as String? ?? '',
        travelerId: r['travelerId'] as String? ?? '',
        requestedAt: DateTime.parse(r['requestedAt'] as String),
        requestExpiresAt: DateTime.parse(r['requestExpiresAt'] as String),
        requestedArchiveItemId: r['requestedArchiveItemId'] as String?,
        proposedMeetingTime:
            (proposedTime != null) ? DateTime.parse(proposedTime) : null,
        counterProposal: CounterProposalSummary.fromMap(counterMap),
      );
    }).toList();
  }

  /// 동행 요청을 수락/거절한다.
  ///
  /// 수락 시 만남 장소는 좌표([meetingLat]/[meetingLng]) 또는 안내자 본인의
  /// 동네 지식([meetingArchiveItemId]) 중 하나로 지정해야 한다.
  Future<void> respondToRequest({
    required String escortId,
    required bool accept,
    double? meetingLat,
    double? meetingLng,
    String? meetingArchiveItemId,
    String? meetingTime,
  }) async {
    final callable = _fn.httpsCallable('respondToRequest');
    await callable.call<Map<String, dynamic>>({
      'escortId': escortId,
      'accept': accept,
      if (accept && meetingArchiveItemId != null)
        'meetingArchiveItemId': meetingArchiveItemId,
      if (accept && meetingArchiveItemId == null)
        'meetingLocation': {'lat': meetingLat, 'lng': meetingLng},
      if (accept) 'meetingTime': meetingTime,
    });
  }

  /// 만남 시간/장소를 재제안한다("이 시간은 어려운데 이 시간은 어떠세요").
  /// Requested 상태에서만 가능하며 escort 당사자만 호출할 수 있다.
  ///
  /// 장소는 [meetingArchiveItemId] 또는 [meetingLat]/[meetingLng] 중 하나로
  /// 지정할 수 있다. 아무것도 지정하지 않으면 서버가 기존 만남 장소를 그대로
  /// 유지한다(시간만 재제안하는 흔한 경우).
  Future<void> proposeCounterOffer({
    required String escortId,
    required DateTime meetingTime,
    double? meetingLat,
    double? meetingLng,
    String? meetingArchiveItemId,
    String? message,
  }) async {
    final callable = _fn.httpsCallable('proposeCounterOffer');
    await callable.call<Map<String, dynamic>>({
      'escortId': escortId,
      'meetingTime': meetingTime.toUtc().toIso8601String(),
      if (meetingArchiveItemId != null)
        'meetingArchiveItemId': meetingArchiveItemId,
      if (meetingArchiveItemId == null &&
          meetingLat != null &&
          meetingLng != null)
        'meetingLocation': {'lat': meetingLat, 'lng': meetingLng},
      if (message != null && message.trim().isNotEmpty)
        'message': message.trim(),
    });
  }

  /// 상대방이 보낸 재제안을 수락해 MeetingConfirmed로 전환한다.
  Future<void> acceptCounterOffer({required String escortId}) async {
    final callable = _fn.httpsCallable('acceptCounterOffer');
    await callable.call<Map<String, dynamic>>({'escortId': escortId});
  }

  /// 상대방의 응답(승인/거절) 결과 안내를 확인했음을 기록한다.
  /// 이후 같은 결과가 재로그인 시 반복 안내되지 않게 한다.
  Future<void> acknowledgeEscortResponse({required String escortId}) async {
    final callable = _fn.httpsCallable('acknowledgeEscortResponse');
    await callable.call<Map<String, dynamic>>({'escortId': escortId});
  }
}
