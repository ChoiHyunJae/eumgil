import 'package:app/screens/approved_guides_screen.dart';
import 'package:app/services/admin_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// 승인된 안내자 목록/자격 상실을 기록하는 가짜 AdminService.
class _FakeAdminService extends AdminService {
  _FakeAdminService(this._guides);

  List<ApprovedGuide> _guides;
  final List<String> rejected = [];

  @override
  Future<List<ApprovedGuide>> listApprovedGuides() async => _guides;

  @override
  Future<void> reject(String userId) async {
    rejected.add(userId);
    _guides = _guides.where((g) => g.userId != userId).toList();
  }
}

void main() {
  testWidgets('승인된 안내자 목록을 표시한다', (tester) async {
    final fake = _FakeAdminService([
      const ApprovedGuide(
        userId: 'guide-1',
        phoneNumber: '+821000000000',
        residenceYears: 10,
        interests: ['역사', '맛집'],
      ),
    ]);
    await tester.pumpWidget(
      MaterialApp(home: ApprovedGuidesScreen(service: fake)),
    );
    await tester.pumpAndSettle();

    expect(find.text('guide-1'), findsOneWidget);
    expect(find.textContaining('거주 10년'), findsOneWidget);
    expect(find.text('자격 상실 처리'), findsOneWidget);
  });

  testWidgets('자격 상실은 확인 다이얼로그 뒤 reject를 호출한다', (tester) async {
    final fake = _FakeAdminService([const ApprovedGuide(userId: 'guide-1')]);
    await tester.pumpWidget(
      MaterialApp(home: ApprovedGuidesScreen(service: fake)),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('자격 상실 처리'));
    await tester.pumpAndSettle();

    // 확인 다이얼로그
    expect(find.text('자격 상실 처리'), findsWidgets);
    await tester.tap(find.widgetWithText(ElevatedButton, '자격 상실'));
    await tester.pumpAndSettle();

    expect(fake.rejected, contains('guide-1'));
    expect(find.text('승인된 안내자가 없습니다.'), findsOneWidget);
  });

  testWidgets('승인된 안내자가 없으면 빈 상태를 표시한다', (tester) async {
    final fake = _FakeAdminService(const []);
    await tester.pumpWidget(
      MaterialApp(home: ApprovedGuidesScreen(service: fake)),
    );
    await tester.pumpAndSettle();

    expect(find.text('승인된 안내자가 없습니다.'), findsOneWidget);
  });
}
