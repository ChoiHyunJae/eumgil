import 'package:flutter/material.dart';

import '../services/escort_service.dart';

/// 현재 로그인 사용자(traveler 또는 guide)의 진행 중 동행을 보여주고,
/// 시작 전 동행을 취소할 수 있는 최소 화면.
///
/// listMyEscorts로 목록을 조회하고 cancelEscort로 취소한다. confirmMeeting/
/// checkArrival 등 그 이후 단계는 이번 범위가 아니다.
class MyEscortScreen extends StatefulWidget {
  const MyEscortScreen({super.key, this.service});

  /// 테스트에서 가짜 구현을 주입하기 위한 선택적 의존성. null이면 기본 생성.
  final EscortService? service;

  @override
  State<MyEscortScreen> createState() => _MyEscortScreenState();
}

class _MyEscortScreenState extends State<MyEscortScreen> {
  late final EscortService _service;

  bool _loading = true;
  Object? _error;
  List<MyEscortSummary> _escorts = const [];

  /// 처리 중인 escortId 집합(중복 클릭 방지 및 버튼 비활성화용).
  final Set<String> _processing = <String>{};

  @override
  void initState() {
    super.initState();
    _service = widget.service ?? EscortService();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final escorts = await _service.listMyEscorts();
      if (!mounted) return;
      setState(() {
        _escorts = escorts;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e;
        _loading = false;
      });
    }
  }

  void _snack(String message) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _cancel(MyEscortSummary escort) async {
    if (_processing.contains(escort.escortId)) return;
    setState(() => _processing.add(escort.escortId));
    try {
      await _service.cancelEscort(escortId: escort.escortId);
      if (!mounted) return;
      _snack('동행을 취소했습니다.');
      await _load();
    } catch (e) {
      if (!mounted) return;
      _snack('취소에 실패했습니다: $e');
    } finally {
      if (mounted) {
        setState(() => _processing.remove(escort.escortId));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('내 동행'),
        actions: [
          IconButton(
            onPressed: _loading ? null : _load,
            icon: const Icon(Icons.refresh),
            tooltip: '새로고침',
          ),
        ],
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('동행을 불러오지 못했습니다.'),
            const SizedBox(height: 12),
            ElevatedButton(onPressed: _load, child: const Text('다시 시도')),
          ],
        ),
      );
    }
    if (_escorts.isEmpty) {
      return const Center(child: Text('진행 중인 동행이 없습니다.'));
    }
    return ListView.builder(
      itemCount: _escorts.length,
      itemBuilder: (context, index) => _buildCard(_escorts[index]),
    );
  }

  Widget _buildCard(MyEscortSummary escort) {
    final processing = _processing.contains(escort.escortId);
    final meeting = escort.meetingTime == null
        ? '미정'
        : escort.meetingTime!.toLocal().toString();
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '상태: ${escort.status}',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 4),
            Text('escortId: ${escort.escortId}'),
            Text('탐방자: ${escort.travelerId}'),
            Text('안내자: ${escort.guideId}'),
            Text('만남 시간: $meeting'),
            const SizedBox(height: 12),
            Align(
              alignment: Alignment.centerRight,
              child: processing
                  ? const SizedBox(
                      width: 24,
                      height: 24,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : OutlinedButton(
                      onPressed: () => _cancel(escort),
                      child: const Text('동행 취소'),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
