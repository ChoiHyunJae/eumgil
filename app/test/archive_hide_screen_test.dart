import 'package:app/screens/archive_hide_screen.dart';
import 'package:app/services/admin_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// 신고 목록/숨김/삭제를 기록하는 가짜 AdminService(Firebase 불필요).
class _FakeAdminService extends AdminService {
  _FakeAdminService(this._items);

  List<ReportedArchiveItem> _items;
  final List<String> hidden = [];
  final List<String> deleted = [];

  @override
  Future<List<ReportedArchiveItem>> listReportedArchiveItems({
    bool includeHidden = false,
  }) async {
    return _items;
  }

  @override
  Future<void> hideArchiveItem({required String itemId, String? reason}) async {
    hidden.add(itemId);
  }

  @override
  Future<void> deleteArchiveItem({
    required String itemId,
    String? reason,
  }) async {
    deleted.add(itemId);
    _items = _items.where((i) => i.itemId != itemId).toList();
  }
}

ReportedArchiveItem _item(String id, {int reportCount = 3}) {
  return ReportedArchiveItem(
    itemId: id,
    authorId: 'guide-1',
    category: 'PLACE',
    body: '신고 본문',
    reportCount: reportCount,
    hidden: false,
    dongLabel: '종로구 사직동 인근',
  );
}

void main() {
  testWidgets('신고 항목 목록과 reportCount가 표시된다', (tester) async {
    final fake = _FakeAdminService([_item('it-1', reportCount: 7)]);
    await tester.pumpWidget(
      MaterialApp(home: ArchiveHideScreen(service: fake)),
    );
    await tester.pumpAndSettle();

    expect(find.text('신고 7건'), findsOneWidget);
    expect(find.text('숨김 처리'), findsOneWidget);
    expect(find.text('삭제'), findsOneWidget);
  });

  testWidgets('숨김 처리 버튼이 hideArchiveItem을 호출한다', (tester) async {
    final fake = _FakeAdminService([_item('it-1')]);
    await tester.pumpWidget(
      MaterialApp(home: ArchiveHideScreen(service: fake)),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('숨김 처리'));
    await tester.pumpAndSettle();

    expect(fake.hidden, contains('it-1'));
  });

  testWidgets('삭제는 확인 다이얼로그 뒤 deleteArchiveItem을 호출한다', (tester) async {
    final fake = _FakeAdminService([_item('it-1')]);
    await tester.pumpWidget(
      MaterialApp(home: ArchiveHideScreen(service: fake)),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('삭제'));
    await tester.pumpAndSettle();

    // 확인 다이얼로그가 뜬다(카드의 '삭제'와 구분해 다이얼로그 내 버튼을 누른다).
    expect(find.text('삭제 확인'), findsOneWidget);
    await tester.tap(
      find.descendant(
        of: find.byType(AlertDialog),
        matching: find.widgetWithText(ElevatedButton, '삭제'),
      ),
    );
    await tester.pumpAndSettle();

    expect(fake.deleted, contains('it-1'));
    expect(find.text('검토할 신고 항목이 없습니다.'), findsOneWidget);
  });

  testWidgets('신고 항목이 없으면 빈 상태를 표시한다', (tester) async {
    final fake = _FakeAdminService(const []);
    await tester.pumpWidget(
      MaterialApp(home: ArchiveHideScreen(service: fake)),
    );
    await tester.pumpAndSettle();

    expect(find.text('검토할 신고 항목이 없습니다.'), findsOneWidget);
  });
}
