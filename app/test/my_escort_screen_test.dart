import 'package:app/screens/my_escort_screen.dart';
import 'package:app/services/escort_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// EscortService의 가짜 구현. Firebase 없이 MyEscortScreen을 위젯 테스트한다.
class _FakeEscortService extends EscortService {
  _FakeEscortService(this._items);

  List<MyEscortSummary> _items;
  final List<String> cancelled = [];
  final List<String> confirmed = [];

  @override
  Future<List<MyEscortSummary>> listMyEscorts() async => _items;

  @override
  Future<void> cancelEscort({required String escortId}) async {
    cancelled.add(escortId);
    _items = _items.where((e) => e.escortId != escortId).toList();
  }

  @override
  Future<String> confirmMeeting({
    required String escortId,
    required double lat,
    required double lng,
  }) async {
    confirmed.add(escortId);
    _items = _items
        .map(
          (e) => e.escortId == escortId
              ? MyEscortSummary(
                  escortId: e.escortId,
                  guideId: e.guideId,
                  travelerId: e.travelerId,
                  status: 'InProgress',
                  meetingTime: e.meetingTime,
                )
              : e,
        )
        .toList();
    return 'InProgress';
  }
}

void main() {
  testWidgets('진행 중 동행 목록을 표시한다', (tester) async {
    final fake = _FakeEscortService([
      const MyEscortSummary(
        escortId: 'esc-1',
        guideId: 'guide-1',
        travelerId: 'traveler-1',
        status: 'MeetingConfirmed',
      ),
    ]);

    await tester.pumpWidget(
      MaterialApp(home: MyEscortScreen(service: fake)),
    );
    await tester.pumpAndSettle();

    expect(find.text('상태: MeetingConfirmed'), findsOneWidget);
    expect(find.text('탐방자: traveler-1'), findsOneWidget);
    expect(find.text('동행 취소'), findsOneWidget);
  });

  testWidgets('동행이 없으면 빈 안내를 표시한다', (tester) async {
    final fake = _FakeEscortService(const []);

    await tester.pumpWidget(
      MaterialApp(home: MyEscortScreen(service: fake)),
    );
    await tester.pumpAndSettle();

    expect(find.text('진행 중인 동행이 없습니다.'), findsOneWidget);
  });

  testWidgets('동행 취소 버튼을 누르면 cancelEscort가 호출되고 목록이 갱신된다', (
    tester,
  ) async {
    final fake = _FakeEscortService([
      const MyEscortSummary(
        escortId: 'esc-1',
        guideId: 'guide-1',
        travelerId: 'traveler-1',
        status: 'MeetingConfirmed',
      ),
    ]);

    await tester.pumpWidget(
      MaterialApp(home: MyEscortScreen(service: fake)),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('동행 취소'));
    await tester.pumpAndSettle();

    expect(fake.cancelled, contains('esc-1'));
    expect(find.text('진행 중인 동행이 없습니다.'), findsOneWidget);
  });

  testWidgets('MeetingConfirmed 카드에서 만났어요로 confirmMeeting 호출 후 목록 갱신', (
    tester,
  ) async {
    final fake = _FakeEscortService([
      const MyEscortSummary(
        escortId: 'esc-1',
        guideId: 'guide-1',
        travelerId: 'traveler-1',
        status: 'MeetingConfirmed',
      ),
    ]);

    await tester.pumpWidget(
      MaterialApp(home: MyEscortScreen(service: fake)),
    );
    await tester.pumpAndSettle();

    expect(find.text('만났어요'), findsOneWidget);
    await tester.tap(find.text('만났어요'));
    await tester.pumpAndSettle();

    // 위치 입력 다이얼로그가 뜬다.
    expect(find.text('현재 위치 입력'), findsOneWidget);
    await tester.enterText(find.byType(TextFormField).at(0), '37.5665');
    await tester.enterText(find.byType(TextFormField).at(1), '126.9780');
    await tester.tap(find.text('확인'));
    await tester.pumpAndSettle();

    expect(fake.confirmed, contains('esc-1'));
    expect(find.text('상태: InProgress'), findsOneWidget);
  });
}
