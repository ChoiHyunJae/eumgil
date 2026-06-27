import 'package:app/screens/archive_create_screen.dart';
import 'package:app/services/archive_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// createArchiveItem 호출을 기록하는 가짜 ArchiveService(Firebase 불필요).
class _FakeArchiveService extends ArchiveService {
  ArchiveCategory? lastCategory;
  String? lastTranscript;
  List<String>? lastPhotoUrls;
  int createCalls = 0;

  @override
  Future<String> createArchiveItem({
    required ArchiveCategory category,
    required String voiceTranscript,
    required double lat,
    required double lng,
    List<String>? photoUrls,
  }) async {
    createCalls += 1;
    lastCategory = category;
    lastTranscript = voiceTranscript;
    lastPhotoUrls = photoUrls;
    return 'fake-id';
  }
}

void main() {
  /// 화면 전체가 보이도록 큰 뷰포트로 화면을 띄운다(off-screen tap 방지).
  Future<void> pumpScreen(WidgetTester tester, ArchiveService service) async {
    tester.view.physicalSize = const Size(1200, 2600);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(home: ArchiveCreateScreen(service: service)),
    );
    await tester.pumpAndSettle();
  }

  /// 분류 드롭다운에서 [label]을 선택한다.
  Future<void> selectCategory(WidgetTester tester, String label) async {
    await tester.tap(find.byType(DropdownButtonFormField<ArchiveCategory>));
    await tester.pumpAndSettle();
    await tester.tap(find.text(label).last);
    await tester.pumpAndSettle();
  }

  Future<void> enterContent(WidgetTester tester, String text) {
    return tester.enterText(
      find.widgetWithText(TextFormField, '경험담 (1인칭)'),
      text,
    );
  }

  Future<void> enterCoords(WidgetTester tester) async {
    await tester.enterText(
      find.widgetWithText(TextFormField, '위도(lat)'),
      '37.5',
    );
    await tester.enterText(
      find.widgetWithText(TextFormField, '경도(lng)'),
      '126.9',
    );
  }

  Future<void> confirmLocation(WidgetTester tester) async {
    await tester.tap(find.text('이 위치로 등록할까요?'));
    await tester.pumpAndSettle();
  }

  Future<void> tapSubmit(WidgetTester tester) async {
    await tester.tap(find.widgetWithText(ElevatedButton, '등록'));
    await tester.pumpAndSettle();
  }

  testWidgets('1인칭 안내 문구가 표시된다', (tester) async {
    await pumpScreen(tester, _FakeArchiveService());
    expect(find.textContaining('1인칭'), findsWidgets);
  });

  testWidgets('카테고리 미선택 시 등록되지 않는다', (tester) async {
    final fake = _FakeArchiveService();
    await pumpScreen(tester, fake);
    await enterContent(tester, '제가 가본 곳');
    await enterCoords(tester);
    await confirmLocation(tester);
    await tapSubmit(tester);
    expect(fake.createCalls, 0);
  });

  testWidgets('내용 미입력 시 등록되지 않는다', (tester) async {
    final fake = _FakeArchiveService();
    await pumpScreen(tester, fake);
    await selectCategory(tester, '가게/장소');
    await enterCoords(tester);
    await confirmLocation(tester);
    await tapSubmit(tester);
    expect(fake.createCalls, 0);
  });

  testWidgets('위치 확인 전에는 등록되지 않는다', (tester) async {
    final fake = _FakeArchiveService();
    await pumpScreen(tester, fake);
    await selectCategory(tester, '가게/장소');
    await enterContent(tester, '제가 가본 곳');
    await enterCoords(tester);
    // 위치 확인 버튼을 누르지 않음.
    await tapSubmit(tester);
    expect(fake.createCalls, 0);
  });

  testWidgets('위치 확인 후 등록되고 사진 URL이 전달된다', (tester) async {
    final fake = _FakeArchiveService();
    await pumpScreen(tester, fake);
    await selectCategory(tester, '산책길');
    await enterContent(tester, '제가 산책한 길');
    await tester.enterText(
      find.widgetWithText(TextFormField, '사진 URL (선택)'),
      'https://example.com/p.jpg',
    );
    await enterCoords(tester);
    await confirmLocation(tester);
    await tapSubmit(tester);

    expect(fake.createCalls, 1);
    expect(fake.lastCategory, ArchiveCategory.walk);
    expect(fake.lastTranscript, '제가 산책한 길');
    expect(fake.lastPhotoUrls, ['https://example.com/p.jpg']);
  });

  testWidgets('데모 위치 버튼이 좌표를 채운다', (tester) async {
    await pumpScreen(tester, _FakeArchiveService());
    await tester.tap(find.text('데모 위치 사용'));
    await tester.pumpAndSettle();
    expect(find.text('37.57295'), findsOneWidget);
    expect(find.text('126.97936'), findsOneWidget);
  });
}
