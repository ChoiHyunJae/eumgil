import 'package:flutter/material.dart';

import '../services/matching_service.dart';

/// 안내자가 자신에게 들어온 Requested 동행 요청을 확인하고 수락/거절하는 화면.
///
/// 백엔드 listReceivedEscortRequests로 목록을 조회하고, respondToRequest로
/// 수락(만남 위치·시간 수동 입력)/거절을 처리한다. 지도/GPS/DatePicker는 이번
/// 범위에서 제외하며 좌표·시간은 수동 입력만 받는다.
class ReceivedEscortRequestsScreen extends StatefulWidget {
  const ReceivedEscortRequestsScreen({super.key, this.service});

  /// 테스트에서 가짜 구현을 주입하기 위한 선택적 의존성. null이면 기본 생성.
  final MatchingService? service;

  @override
  State<ReceivedEscortRequestsScreen> createState() =>
      _ReceivedEscortRequestsScreenState();
}

class _ReceivedEscortRequestsScreenState
    extends State<ReceivedEscortRequestsScreen> {
  late final MatchingService _service;

  bool _loading = true;
  Object? _error;
  List<ReceivedEscortRequestSummary> _requests = const [];

  /// 처리 중인 escortId 집합(중복 클릭 방지 및 버튼 비활성화용).
  final Set<String> _processing = <String>{};

  @override
  void initState() {
    super.initState();
    _service = widget.service ?? MatchingService();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final requests = await _service.listReceivedEscortRequests();
      if (!mounted) return;
      setState(() {
        _requests = requests;
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

  void _removeFromList(String escortId) {
    setState(() {
      _requests = _requests.where((r) => r.escortId != escortId).toList();
    });
  }

  void _snack(String message) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _reject(ReceivedEscortRequestSummary req) async {
    if (_processing.contains(req.escortId)) return;
    setState(() => _processing.add(req.escortId));
    try {
      await _service.respondToRequest(escortId: req.escortId, accept: false);
      if (!mounted) return;
      _removeFromList(req.escortId);
      _snack('요청을 거절했습니다.');
    } catch (e) {
      if (!mounted) return;
      _snack('처리에 실패했습니다: $e');
    } finally {
      if (mounted) {
        setState(() => _processing.remove(req.escortId));
      }
    }
  }

  Future<void> _accept(ReceivedEscortRequestSummary req) async {
    if (_processing.contains(req.escortId)) return;
    final input = await showDialog<_MeetingInput>(
      context: context,
      builder: (_) => const _MeetingInputDialog(),
    );
    // 다이얼로그를 취소하면 null이 반환된다.
    if (input == null || !mounted) return;

    setState(() => _processing.add(req.escortId));
    try {
      await _service.respondToRequest(
        escortId: req.escortId,
        accept: true,
        meetingLat: input.lat,
        meetingLng: input.lng,
        meetingTime: input.timeIso,
      );
      if (!mounted) return;
      _removeFromList(req.escortId);
      _snack('동행을 수락했습니다.');
    } catch (e) {
      if (!mounted) return;
      _snack('처리에 실패했습니다: $e');
    } finally {
      if (mounted) {
        setState(() => _processing.remove(req.escortId));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('받은 동행 요청'),
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
            const Text('요청을 불러오지 못했습니다.'),
            const SizedBox(height: 12),
            ElevatedButton(onPressed: _load, child: const Text('다시 시도')),
          ],
        ),
      );
    }
    if (_requests.isEmpty) {
      return const Center(child: Text('받은 동행 요청이 없습니다.'));
    }
    return ListView.builder(
      itemCount: _requests.length,
      itemBuilder: (context, index) => _buildCard(_requests[index]),
    );
  }

  Widget _buildCard(ReceivedEscortRequestSummary req) {
    final processing = _processing.contains(req.escortId);
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '탐방자: ${req.travelerId}',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 4),
            Text('요청 시각: ${req.requestedAt.toLocal()}'),
            Text('만료 시각: ${req.requestExpiresAt.toLocal()}'),
            const SizedBox(height: 12),
            if (processing)
              const Align(
                alignment: Alignment.centerRight,
                child: SizedBox(
                  width: 24,
                  height: 24,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              )
            else
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton(
                    onPressed: () => _reject(req),
                    child: const Text('거절'),
                  ),
                  const SizedBox(width: 8),
                  ElevatedButton(
                    onPressed: () => _accept(req),
                    child: const Text('수락'),
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }
}

/// 수락 다이얼로그가 반환하는 만남 입력값(검증을 통과한 값).
class _MeetingInput {
  const _MeetingInput({
    required this.lat,
    required this.lng,
    required this.timeIso,
  });

  final double lat;
  final double lng;
  final String timeIso;
}

/// 만남 위치(lat/lng)와 시간(ISO 문자열)을 수동 입력받는 다이얼로그.
/// "수락"은 검증을 통과한 [_MeetingInput]을, "취소"는 null을 반환한다.
class _MeetingInputDialog extends StatefulWidget {
  const _MeetingInputDialog();

  @override
  State<_MeetingInputDialog> createState() => _MeetingInputDialogState();
}

class _MeetingInputDialogState extends State<_MeetingInputDialog> {
  final _formKey = GlobalKey<FormState>();
  final _latController = TextEditingController();
  final _lngController = TextEditingController();
  final _timeController = TextEditingController();

  @override
  void dispose() {
    _latController.dispose();
    _lngController.dispose();
    _timeController.dispose();
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

  String? _validateTime(String? value) {
    if (value == null || value.trim().isEmpty) {
      return '필수 입력 항목입니다.';
    }
    if (DateTime.tryParse(value.trim()) == null) {
      return 'ISO 형식이 올바르지 않습니다.';
    }
    return null;
  }

  void _confirm() {
    if (!_formKey.currentState!.validate()) return;
    Navigator.of(context).pop(
      _MeetingInput(
        lat: double.parse(_latController.text.trim()),
        lng: double.parse(_lngController.text.trim()),
        timeIso: _timeController.text.trim(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('만남 위치/시간 입력'),
      content: Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextFormField(
              controller: _latController,
              decoration: const InputDecoration(
                labelText: '만남 위도(lat)',
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
                labelText: '만남 경도(lng)',
                hintText: '126.9780',
              ),
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
                signed: true,
              ),
              validator: _validateNumber,
            ),
            TextFormField(
              controller: _timeController,
              decoration: const InputDecoration(
                labelText: '만남 시간(ISO)',
                hintText: '2026-08-01T10:00:00.000Z',
              ),
              validator: _validateTime,
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('취소'),
        ),
        ElevatedButton(onPressed: _confirm, child: const Text('수락')),
      ],
    );
  }
}
