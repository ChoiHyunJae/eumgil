import 'package:flutter/material.dart';

import '../services/escort_service.dart';

/// 현재 로그인 사용자(traveler 또는 guide)의 진행 중 동행을 보여주고,
/// 시작 전 동행을 취소할 수 있는 최소 화면.
///
/// listMyEscorts로 목록을 조회하고 cancelEscort로 취소한다. confirmMeeting/
/// checkArrival 등 그 이후 단계는 이번 범위가 아니다.
class MyEscortScreen extends StatefulWidget {
  const MyEscortScreen({super.key, this.service, this.currentUserId});

  /// 테스트에서 가짜 구현을 주입하기 위한 선택적 의존성. null이면 기본 생성.
  final EscortService? service;

  /// 현재 로그인 사용자 uid. travelerId와 일치하면 만족도 평가 입력을 노출한다.
  /// null이거나 guide면 평가 입력을 보여주지 않는다(guide가 rating을 보내지 않도록).
  final String? currentUserId;

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

  /// 이미 안내 다이얼로그를 보여준 escortId 집합(중복 알림 방지).
  final Set<String> _notified = <String>{};

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
      // 승인(MeetingConfirmed)/거절(Rejected) 상태인 항목 중 아직 안내하지
      // 않은 것만 다이얼로그로 알린다.
      for (final escort in escorts) {
        if ((escort.status == 'MeetingConfirmed' ||
                escort.status == 'Rejected') &&
            !_notified.contains(escort.escortId)) {
          _notified.add(escort.escortId);
          await _notifyIfNeeded(escort);
        }
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e;
        _loading = false;
      });
    }
  }

  void _snack(String message, {bool success = true}) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(message),
      backgroundColor:
          success ? const Color(0xFF1B8A6B) : Colors.red.shade700,
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ));
  }

  /// 안내자 응답(수락/거절) 결과를 확인 다이얼로그로 안내한다.
  /// 수락(MeetingConfirmed)이면 만남 시간/장소를 보여주고 확인을 요청하며,
  /// 거절(Rejected)이면 거절 사실만 안내한다. 두 경우 모두 확인 후 목록을
  /// 새로고침해 같은 안내가 중복 노출되지 않게 한다.
  Future<void> _notifyIfNeeded(MyEscortSummary escort) async {
    if (!_isTraveler(escort)) return; // 안내자 본인에게는 노출하지 않음

    if (escort.status == 'MeetingConfirmed') {
      final meeting = escort.meetingTime == null
          ? '미정'
          : _formatDateTime(escort.meetingTime!.toLocal());
      final place = escort.meetingLocationLabel ?? '안내자가 지정한 장소';
      await showDialog<void>(
        context: context,
        builder: (_) => AlertDialog(
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
          title: const Text('동행 요청을 승인했습니다'),
          content: Text(
            '안내자가 동행 요청을 승인했습니다.\n\n'
            '만남 시간: $meeting\n'
            '만남 장소: $place\n\n'
            '이 시간과 장소가 괜찮으신가요?',
            style: const TextStyle(height: 1.6),
          ),
          actions: [
            ElevatedButton(
              onPressed: () => Navigator.pop(context),
              style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF1B8A6B)),
              child: const Text('확인했어요'),
            ),
          ],
        ),
      );
    } else if (escort.status == 'Rejected') {
      await showDialog<void>(
        context: context,
        builder: (_) => AlertDialog(
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
          title: const Text('동행 요청이 거절되었습니다'),
          content: const Text(
            '안내자가 이번 동행 요청을 거절했습니다.\n다른 안내자를 찾아보세요.',
            style: TextStyle(height: 1.6),
          ),
          actions: [
            ElevatedButton(
              onPressed: () => Navigator.pop(context),
              style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.red.shade600),
              child: const Text('확인했어요'),
            ),
          ],
        ),
      );
    }
  }

  String _formatDateTime(DateTime dt) {
    return '${dt.month}월 ${dt.day}일 ${dt.hour.toString().padLeft(2, '0')}:'
        '${dt.minute.toString().padLeft(2, '0')}';
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
    final isRejected = escort.status == 'Rejected';
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
            if (!isRejected) Text('만남 시간: $meeting'),
            if (!isRejected && escort.meetingLocationLabel != null)
              Text('만남 장소: ${escort.meetingLocationLabel}'),
            const SizedBox(height: 12),
            if (!isRejected)
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
    final inProgress = escort.status == 'InProgress';
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
        if (inProgress)
          ElevatedButton(
            onPressed: () => _complete(escort),
            child: const Text('동행 완료'),
          ),
        if (inProgress)
          OutlinedButton(
            onPressed: () => _midTerminate(escort),
            child: const Text('중도 종료'),
          ),
      ],
    );
  }

  bool _isTraveler(MyEscortSummary escort) =>
      widget.currentUserId != null &&
      widget.currentUserId == escort.travelerId;

  /// 동행 완료를 확인한다. traveler면 만족도 평가(선택)를 입력받고, guide면
  /// rating 없이 곧바로 완료 확인한다(guide가 rating을 보내지 않도록).
  Future<void> _complete(MyEscortSummary escort) async {
    if (_processing.contains(escort.escortId)) return;

    int? rating;
    if (_isTraveler(escort)) {
      final choice = await showDialog<_RatingChoice>(
        context: context,
        builder: (_) => const _RatingDialog(),
      );
      if (choice == null || !mounted) return; // 취소
      rating = choice.rating;
    }

    setState(() => _processing.add(escort.escortId));
    try {
      final status = await _service.completeEscort(
        escortId: escort.escortId,
        satisfactionRating: rating,
      );
      if (!mounted) return;
      _snack(
        status == 'Completed' ? '동행이 완료되었습니다.' : '완료 확인했습니다(상대 확인 대기).',
      );
      await _load();
    } catch (e) {
      if (!mounted) return;
      _snack('완료 처리에 실패했습니다: $e');
    } finally {
      if (mounted) {
        setState(() => _processing.remove(escort.escortId));
      }
    }
  }

  /// 동행을 중도 종료한다. 사유(선택)를 다이얼로그로 입력받는다.
  Future<void> _midTerminate(MyEscortSummary escort) async {
    if (_processing.contains(escort.escortId)) return;
    final choice = await showDialog<_ReasonChoice>(
      context: context,
      builder: (_) => const _MidTerminateDialog(),
    );
    if (choice == null || !mounted) return; // 취소

    setState(() => _processing.add(escort.escortId));
    try {
      await _service.midTerminate(
        escortId: escort.escortId,
        reason: choice.reason,
      );
      if (!mounted) return;
      _snack('동행을 중도 종료했습니다.');
      await _load();
    } catch (e) {
      if (!mounted) return;
      _snack('중도 종료에 실패했습니다: $e');
    } finally {
      if (mounted) {
        setState(() => _processing.remove(escort.escortId));
      }
    }
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

/// 동행 완료(traveler) 다이얼로그 결과. rating은 미선택이면 null.
class _RatingChoice {
  const _RatingChoice(this.rating);

  final int? rating;
}

/// 탐방자 만족도 평가(선택, 1~5) 입력 다이얼로그.
/// "완료"는 선택값을 담은 [_RatingChoice]를, "취소"는 null을 반환한다.
class _RatingDialog extends StatefulWidget {
  const _RatingDialog();

  @override
  State<_RatingDialog> createState() => _RatingDialogState();
}

class _RatingDialogState extends State<_RatingDialog> {
  int? _rating;

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('동행 완료'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text('만족도 평가(선택)'),
          const SizedBox(height: 8),
          DropdownButton<int?>(
            value: _rating,
            hint: const Text('선택 안 함'),
            items: const [
              DropdownMenuItem(value: null, child: Text('선택 안 함')),
              DropdownMenuItem(value: 1, child: Text('1')),
              DropdownMenuItem(value: 2, child: Text('2')),
              DropdownMenuItem(value: 3, child: Text('3')),
              DropdownMenuItem(value: 4, child: Text('4')),
              DropdownMenuItem(value: 5, child: Text('5')),
            ],
            onChanged: (value) => setState(() => _rating = value),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('취소'),
        ),
        ElevatedButton(
          onPressed: () => Navigator.of(context).pop(_RatingChoice(_rating)),
          child: const Text('완료'),
        ),
      ],
    );
  }
}

/// 중도 종료 다이얼로그 결과. reason은 미입력이면 null.
class _ReasonChoice {
  const _ReasonChoice(this.reason);

  final String? reason;
}

/// 중도 종료 사유(선택) 입력 다이얼로그.
/// "확인"은 사유를 담은 [_ReasonChoice]를, "취소"는 null을 반환한다.
class _MidTerminateDialog extends StatefulWidget {
  const _MidTerminateDialog();

  @override
  State<_MidTerminateDialog> createState() => _MidTerminateDialogState();
}

class _MidTerminateDialogState extends State<_MidTerminateDialog> {
  final _reasonController = TextEditingController();

  @override
  void dispose() {
    _reasonController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('중도 종료'),
      content: TextField(
        controller: _reasonController,
        decoration: const InputDecoration(
          labelText: '사유(선택)',
          hintText: '중도 종료 사유를 입력하세요.',
        ),
        minLines: 2,
        maxLines: 4,
        maxLength: 500,
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('취소'),
        ),
        ElevatedButton(
          onPressed: () =>
              Navigator.of(context).pop(_ReasonChoice(_reasonController.text)),
          child: const Text('확인'),
        ),
      ],
    );
  }
}
