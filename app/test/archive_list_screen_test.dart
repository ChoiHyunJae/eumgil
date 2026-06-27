import 'package:app/screens/archive_list_screen.dart';
import 'package:app/services/archive_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// listNearby 결과를 고정 반환하는 가짜 ArchiveService.
class _FakeArchiveService extends ArchiveService {
  _FakeArchiveService(this._items);

  final List<ArchiveItemSummary> _items;

  @override
  Future<List<ArchiveItemSummary>> listNearby({
    required double lat,
    required double lng,
    ArchiveCategory? category,
  }) async {
    return _items;
  }
}

void main() {
  /// 위치를 입력하고 조회한다.
  Future<void> search(WidgetTester tester) async {
    await tester.enterText(
      find.widgetWithText(TextFormField, '위도(lat)'),
      '37.5665',
    );
    await tester.enterText(
      find.widgetWithText(TextFormField, '경도(lng)'),
      '126.978',
    );
    await tester.tap(find.widgetWithText(ElevatedButton, '조회'));
    await tester.pumpAndSettle();
  }

  testWidgets('dongLabel이 표시되고 정확 좌표는 노출되지 않는다', (tester) async {
    final fake = _FakeArchiveService([
      const ArchiveItemSummary(
        id: 'a1',
        category: ArchiveCategory.place,
        body: '제가 가본 좋은 카페',
        dongLabel: '종로구 청운효자동 인근',
      ),
    ]);
    await tester.pumpWidget(
      MaterialApp(home: ArchiveListScreen(service: fake)),
    );
    await search(tester);

    expect(find.text('종로구 청운효자동 인근'), findsOneWidget);
    expect(find.text('제가 가본 좋은 카페'), findsOneWidget);
    // 검색 입력값(37.5665)은 입력칸에만 1개 존재하고, 결과 카드에는 정확 좌표가
    // 중복 노출되지 않는다(요약 모델에 exactLocation이 없음).
    expect(find.text('37.5665'), findsOneWidget);
  });

  testWidgets('author profile(거주/관심)이 있으면 표시된다', (tester) async {
    final fake = _FakeArchiveService([
      const ArchiveItemSummary(
        id: 'a1',
        category: ArchiveCategory.walk,
        body: '제가 걸어본 산책길',
        dongLabel: '종로구 사직동 인근',
        residenceYears: 10,
        interests: ['산책', '맛집'],
      ),
    ]);
    await tester.pumpWidget(
      MaterialApp(home: ArchiveListScreen(service: fake)),
    );
    await search(tester);

    expect(find.textContaining('거주 10년'), findsOneWidget);
    expect(find.textContaining('관심: 산책, 맛집'), findsOneWidget);
  });

  testWidgets('author profile이 없으면 프로필 줄을 표시하지 않는다', (tester) async {
    final fake = _FakeArchiveService([
      const ArchiveItemSummary(
        id: 'a1',
        category: ArchiveCategory.other,
        body: '제가 본 기타 정보',
        dongLabel: '종로구 사직동 인근',
      ),
    ]);
    await tester.pumpWidget(
      MaterialApp(home: ArchiveListScreen(service: fake)),
    );
    await search(tester);

    expect(find.textContaining('거주'), findsNothing);
    expect(find.textContaining('관심:'), findsNothing);
  });
}
