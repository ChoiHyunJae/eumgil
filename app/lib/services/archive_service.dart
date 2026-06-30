import 'package:cloud_functions/cloud_functions.dart';

/// 동네 지식 1차 분류. 백엔드 createArchiveItem의 category 값과 1:1 대응한다.
enum ArchiveCategory {
  place('PLACE', '장소'),
  walk('WALK', '산책로'),
  other('OTHER', '기타');

  const ArchiveCategory(this.wireValue, this.label);

  /// 백엔드 callable로 전송하는 문자열 값.
  final String wireValue;

  /// UI 표시용 한글 라벨.
  final String label;

  /// 백엔드 category 문자열을 enum으로 변환한다. 알 수 없는 값은 other로 처리한다.
  static ArchiveCategory fromWire(String? raw) {
    for (final c in ArchiveCategory.values) {
      if (c.wireValue == raw) return c;
    }
    return ArchiveCategory.other;
  }
}

/// 목록 화면에 표시할 동네 지식 한 건의 최소 정보.
///
/// 백엔드 ArchiveItemPublicView에서 표시에 필요한 필드만 추린다.
/// 정확 좌표(exactLocation)는 응답에 포함되지 않으며, 위치는 [dongLabel]만 노출한다.
class ArchiveItemSummary {
  const ArchiveItemSummary({
    required this.id,
    required this.category,
    required this.body,
    this.dongLabel,
    this.residenceYears,
    this.interests,
  });

  final String id;
  final ArchiveCategory category;

  /// 본문. aiSummary가 있으면 그것을, 없으면 voiceTranscript를 사용한다.
  final String body;

  /// 행정동 단위 위치 표시값(예: "종로구 ○○동 인근"). 없으면 null.
  final String? dongLabel;

  /// 작성 안내자 거주 연차(authorProfile.residenceYears). 없으면 null.
  final int? residenceYears;

  /// 작성 안내자 관심 분야(authorProfile.interests). 없으면 null.
  final List<String>? interests;
}

/// 동네 지식 등록/검색 Cloud Functions callable을 감싸는 service.
///
/// 기존 [GuideService]/[AdminService]와 동일하게 [FirebaseFunctions]를 주입
/// 가능하게 하고, 인스턴스는 호출 시점에 지연 평가한다(테스트 환경 호환).
/// 백엔드 functions는 기본 리전(us-central1)에 배포되므로 기본 인스턴스를 쓴다.
class ArchiveService {
  /// [functions]를 주입하면 그것을, 없으면 기본 인스턴스를 사용한다(테스트용 주입).
  ArchiveService([this._functions]);

  final FirebaseFunctions? _functions;

  FirebaseFunctions get _fn => _functions ?? FirebaseFunctions.instance;

  /// 서버에서 지원하는 동 이름 목록을 조회한다.
  Future<List<String>> getAvailableDongs() async {
    final callable = _fn.httpsCallable('getAvailableDongs');
    final result = await callable.call<Map<String, dynamic>>({});
    final raw = (result.data['dongs'] as List<dynamic>?) ?? <dynamic>[];
    return raw.map((e) => e.toString()).toList();
  }

  /// 동네 지식을 동 단위로 등록한다. 성공 시 생성된 문서 id를 반환한다.
  ///
  /// [dong]과 [location] 중 하나는 반드시 제공해야 한다.
  /// [dong]을 제공하면 해당 동의 대표 좌표를 사용한다.
  Future<String> createArchiveItem({
    required ArchiveCategory category,
    required String voiceTranscript,
    String? dong,
    double? lat,
    double? lng,
    List<String>? photoUrls,
  }) async {
    assert(
      dong != null || (lat != null && lng != null),
      'dong 또는 lat/lng 중 하나는 반드시 제공해야 합니다.',
    );
    final payload = <String, dynamic>{
      'category': category.wireValue,
      'voiceTranscript': voiceTranscript,
    };
    if (dong != null) {
      payload['dong'] = dong;
    } else {
      payload['location'] = {'lat': lat, 'lng': lng};
    }
    if (photoUrls != null && photoUrls.isNotEmpty) {
      payload['photoUrls'] = photoUrls;
    }
    final callable = _fn.httpsCallable('createArchiveItem');
    final result = await callable.call<Map<String, dynamic>>(payload);
    final item = Map<String, dynamic>.from(result.data['item'] as Map);
    return item['id'] as String? ?? '';
  }

  /// 반경 내 공개된 동네 지식 목록을 조회한다.
  ///
  /// 백엔드는 [location](필수)으로 반경 3km 이내, 게시·미숨김 항목만 반환한다.
  /// [category]를 주면 해당 분류로만 필터링한다.
  Future<List<ArchiveItemSummary>> listNearby({
    required double lat,
    required double lng,
    ArchiveCategory? category,
  }) async {
    final payload = <String, dynamic>{
      'location': {'lat': lat, 'lng': lng},
    };
    if (category != null) {
      payload['category'] = category.wireValue;
    }
    final callable = _fn.httpsCallable('listNearbyArchiveItems');
    final result = await callable.call<Map<String, dynamic>>(payload);
    return _parseItems(result.data);
  }

  /// 동 이름으로 해당 동의 공개된 동네 지식 목록을 조회한다.
  ///
  /// [dong]은 [getAvailableDongs]에서 반환된 값 중 하나여야 한다.
  Future<List<ArchiveItemSummary>> listByDong({
    required String dong,
    ArchiveCategory? category,
  }) async {
    final payload = <String, dynamic>{'dong': dong};
    if (category != null) {
      payload['category'] = category.wireValue;
    }
    final callable = _fn.httpsCallable('listArchiveItemsByDong');
    final result = await callable.call<Map<String, dynamic>>(payload);
    return _parseItems(result.data);
  }

  /// 동네 지식을 신고한다. 성공 시 누적 신고 수(reportCount)를 반환한다.
  Future<int> report({required String itemId, String? reason}) async {
    final trimmed = reason?.trim();
    final hasReason = trimmed != null && trimmed.isNotEmpty;
    final callable = _fn.httpsCallable('reportArchiveItem');
    final result = await callable.call<Map<String, dynamic>>({
      'itemId': itemId,
      if (hasReason) 'reason': trimmed,
    });
    return (result.data['reportCount'] as num?)?.toInt() ?? 0;
  }

  /// items 응답 페이로드를 [ArchiveItemSummary] 목록으로 파싱한다.
  List<ArchiveItemSummary> _parseItems(Map<String, dynamic> data) {
    final raw = (data['items'] as List<dynamic>?) ?? <dynamic>[];
    return raw
        .map((dynamic e) => Map<String, dynamic>.from(e as Map))
        .map((item) {
      final summary = (item['aiSummary'] as String?)?.trim();
      final transcript = item['voiceTranscript'] as String? ?? '';
      final profile = item['authorProfile'] == null
          ? null
          : Map<String, dynamic>.from(item['authorProfile'] as Map);
      final interestsRaw = profile?['interests'] as List<dynamic>?;
      return ArchiveItemSummary(
        id: item['id'] as String? ?? '',
        category: ArchiveCategory.fromWire(item['category'] as String?),
        body: (summary != null && summary.isNotEmpty) ? summary : transcript,
        dongLabel: item['dongLabel'] as String?,
        residenceYears: (profile?['residenceYears'] as num?)?.toInt(),
        interests: interestsRaw?.map((e) => e.toString()).toList(),
      );
    }).toList();
  }
}
