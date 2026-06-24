import 'package:flutter_test/flutter_test.dart';

import 'package:app/main.dart';

void main() {
  testWidgets('빈 홈 화면이 렌더링된다', (WidgetTester tester) async {
    await tester.pumpWidget(const EumgilApp());

    expect(find.byType(HomeScreen), findsOneWidget);
    expect(find.text('이음길'), findsWidgets);
  });
}
