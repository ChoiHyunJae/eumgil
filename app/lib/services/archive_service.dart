import 'package:cloud_functions/cloud_functions.dart';

/// 동네 지식 1차 분류. 백엔드 createArchiveItem의 category 값과 1:1 대응한다.
enum ArchiveCategory {
  place('PLACE'),
  walk('WALK'),
  other('OTHER');

  const ArchiveCategory(this.wireValue);

  /// 백엔드 callable로 전송하는 문자열 값.
  final String wireValue;
}

/// 동네 지식 등록 Cloud Functions callable(createArchiveItem)을 감싸는 service.
///
/// 기존 [GuideService]/[AdminService]와 동일하게 [FirebaseFunctions]를 주입
/// 가능하게 하고, 인스턴스는 호출 시점에 지연 평가한다(테스트 환경 호환).
/// 백엔드 functions는 기본 리전(us-central1)에 배포되므로 기본 인스턴스를 쓴다.
class ArchiveService {
  /// [functions]를 주입하면 그것을, 없으면 기본 인스턴스를 사용한다(테스트용 주입).
  ArchiveService([this._functions]);

  final FirebaseFunctions? _functions;

  FirebaseFunctions get _fn => _functions ?? FirebaseFunctions.instance;

  /// 동네 지식을 등록한다. 성공 시 생성된 문서 id를 반환한다.
  ///
  /// 백엔드는 [voiceTranscript](필수)와 [location](필수)을 검증하며, 호출자가
  /// 승인된 안내자가 아니면 permission-denied로 실패한다.
  Future<String> createArchiveItem({
    required ArchiveCategory category,
    required String voiceTranscript,
    required double lat,
    required double lng,
    List<String>? photoUrls,
  }) async {
    final callable = _fn.httpsCallable('createArchiveItem');
    final result = await callable.call<Map<String, dynamic>>({
      'category': category.wireValue,
      'voiceTranscript': voiceTranscript,
      'location': {'lat': lat, 'lng': lng},
      'photoUrls': ?photoUrls,
    });
    final item = Map<String, dynamic>.from(result.data['item'] as Map);
    return item['id'] as String? ?? '';
  }
}
