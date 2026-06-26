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
              child: _buildActions(escort, processing),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildActions(MyEscortSummary escort, bool processing) {
    if (processing) {
      return const SizedBox(
        width: 24,
        height: 24,
        child: CircularProgressIndicator(strokeWidth: 2),
      );
    }
    final cancellable =
        escort.status == 'Accepted' || escort.status == 'MeetingConfirmed';
    final canConfirm = escort.status == 'MeetingConfirmed';
    return Wrap(
      spacing: 8,
      children: [
        if (canConfirm)
          ElevatedButton(
            onPressed: () => _confirmMeeting(escort),
            child: const Text('만났어요'),
          ),
        if (canConfirm)
          TextButton(
            onPressed: () => _judgeNoShow(escort),
            child: const Text('노쇼 판정'),
          ),
        if (cancellable)
          OutlinedButton(
            onPressed: () => _cancel(escort),
            child: const Text('동행 취소'),
          ),
      ],
    );
  }

  Future<void> _judgeNoShow(MyEscortSummary escort) async {
    if (_processing.contains(escort.escortId)) return;
    setState(() => _processing.add(escort.escortId));
    try {
      await _service.judgeNoShow(escortId: escort.escortId);
      if (!mounted) return;
      _snack('노쇼로 판정했습니다.');
      await _load();
    } catch (e) {
      if (!mounted) return;
      _snack('노쇼 판정에 실패했습니다: $e');
    } finally {
      if (mounted) {
        setState(() => _processing.remove(escort.escortId));
      }
    }
  }

  Future<void> _confirmMeeting(MyEscortSummary escort) async {
    if (_processing.contains(escort.escortId)) return;
    final loc = await showDialog<_LatLng>(
      context: context,
      builder: (_) => const _MeetingLocationDialog(),
    );
    if (loc == null || !mounted) return;

    setState(() => _processing.add(escort.escortId));
    try {
      final status = await _service.confirmMeeting(
        escortId: escort.escortId,
        lat: loc.lat,
        lng: loc.lng,
      );
      if (!mounted) return;
      _snack(
        status == 'InProgress' ? '양쪽 확인 완료: 동행을 시작합니다.' : '도착을 확인했습니다.',
      );
      await _load();
    } catch (e) {
      if (!mounted) return;
      _snack('확인에 실패했습니다: $e');
    } finally {
      if (mounted) {
        setState(() => _processing.remove(escort.escortId));
      }
    }
  }
}

/// 만남 확인 다이얼로그가 반환하는 좌표(검증 통과값).
class _LatLng {
  const _LatLng(this.lat, this.lng);

  final double lat;
  final double lng;
}

/// "만났어요" 시 현재 위치(lat/lng)를 수동 입력받는 다이얼로그.
/// GPS 실제 연동은 이번 범위 밖이며, Emulator 검증을 위해 직접 입력받는다.
/// "확인"은 검증 통과 좌표를, "취소"는 null을 반환한다.
class _MeetingLocationDialog extends StatefulWidget {
  const _MeetingLocationDialog();

  @override
  State<_MeetingLocationDialog> createState() => _MeetingLocationDialogState();
}

class _MeetingLocationDialogState extends State<_MeetingLocationDialog> {
  final _formKey = GlobalKey<FormState>();
  final _latController = TextEditingController();
  final _lngController = TextEditingController();

  @override
  void dispose() {
    _latController.dispose();
    _lngController.dispose();
    super.dispose();
  }

  String? _validateNumber(String? value) {
    if (value == null || value.trim().isEmpty) {
      return '필수 입력 항목입니다.';
    }
    if (double.tryParse(value.trim()) == null) {
      return '숫자를 입력하세요.';
    }
    return null;
  }

  void _confirm() {
    if (!_formKey.currentState!.validate()) return;
    Navigator.of(context).pop(
      _LatLng(
        double.parse(_latController.text.trim()),
        double.parse(_lngController.text.trim()),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('현재 위치 입력'),
      content: Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextFormField(
              controller: _latController,
              decoration: const InputDecoration(
                labelText: '위도(lat)',
                hintText: '37.5665',
              ),
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
                signed: true,
              ),
              validator: _validateNumber,
            ),
            TextFormField(
              controller: _lngController,
              decoration: const InputDecoration(
                labelText: '경도(lng)',
                hintText: '126.9780',
              ),
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
                signed: true,
              ),
              validator: _validateNumber,
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('취소'),
        ),
        ElevatedButton(onPressed: _confirm, child: const Text('확인')),
      ],
    );
  }
}
