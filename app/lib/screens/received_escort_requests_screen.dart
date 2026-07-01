import 'package:flutter/material.dart';

import '../services/archive_service.dart';
import '../services/matching_service.dart';

/// 안내자가 자신에게 들어온 Requested 동행 요청을 확인하고 수락/거절하는 화면.
///
/// 수락 시 만남 시간은 달력/시계 선택(DatePicker/TimePicker)으로, 만남 장소는
/// 본인이 등록한 동네 지식 중에서 선택하도록 해 고령 사용자도 쉽게 입력할 수
/// 있게 한다.
class ReceivedEscortRequestsScreen extends StatefulWidget {
  const ReceivedEscortRequestsScreen({
    super.key,
    this.matchingService,
    this.archiveService,
  });

  final MatchingService? matchingService;
  final ArchiveService? archiveService;

  @override
  State<ReceivedEscortRequestsScreen> createState() =>
      _ReceivedEscortRequestsScreenState();
}

class _ReceivedEscortRequestsScreenState
    extends State<ReceivedEscortRequestsScreen> {
  late final MatchingService _matchingService;
  late final ArchiveService _archiveService;

  bool _loading = true;
  Object? _error;
  List<ReceivedEscortRequestSummary> _requests = const [];

  final Set<String> _processing = <String>{};

  @override
  void initState() {
    super.initState();
    _matchingService = widget.matchingService ?? MatchingService();
    _archiveService = widget.archiveService ?? ArchiveService();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final requests = await _matchingService.listReceivedEscortRequests();
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

  void _snack(String message, {bool success = true}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor:
            success ? const Color(0xFF1B8A6B) : Colors.red.shade700,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    );
  }

  Future<void> _reject(ReceivedEscortRequestSummary req) async {
    if (_processing.contains(req.escortId)) return;

    // 거절도 확인 절차를 거친다(오터치 방지, 고령 사용자 배려).
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: const Text('동행 거절'),
        content: const Text('이 동행 요청을 거절할까요?', style: TextStyle(height: 1.6)),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('취소'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, true),
            style: ElevatedButton.styleFrom(
                backgroundColor: Colors.red.shade600),
            child: const Text('거절하기'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() => _processing.add(req.escortId));
    try {
      await _matchingService.respondToRequest(
        escortId: req.escortId,
        accept: false,
      );
      if (!mounted) return;
      _removeFromList(req.escortId);
      _snack('요청을 거절했습니다.', success: false);
    } catch (e) {
      if (!mounted) return;
      _snack('처리에 실패했습니다: $e', success: false);
    } finally {
      if (mounted) setState(() => _processing.remove(req.escortId));
    }
  }

  Future<void> _accept(ReceivedEscortRequestSummary req) async {
    if (_processing.contains(req.escortId)) return;

    final input = await showModalBottomSheet<_MeetingInput>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _MeetingPickerSheet(archiveService: _archiveService),
    );
    if (input == null || !mounted) return;

    setState(() => _processing.add(req.escortId));
    try {
      await _matchingService.respondToRequest(
        escortId: req.escortId,
        accept: true,
        meetingArchiveItemId: input.archiveItemId,
        meetingLat: input.lat,
        meetingLng: input.lng,
        meetingTime: input.dateTime.toUtc().toIso8601String(),
      );
      if (!mounted) return;
      _removeFromList(req.escortId);
      _snack('동행을 수락했습니다.');
    } catch (e) {
      if (!mounted) return;
      _snack('처리에 실패했습니다: $e', success: false);
    } finally {
      if (mounted) setState(() => _processing.remove(req.escortId));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FA),
      appBar: AppBar(
        title: const Text('받은 동행 요청',
            style: TextStyle(fontWeight: FontWeight.w700)),
        backgroundColor: const Color(0xFF1B8A6B),
        foregroundColor: Colors.white,
        elevation: 0,
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
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.inbox_outlined, size: 64, color: Colors.grey.shade300),
            const SizedBox(height: 16),
            const Text('받은 동행 요청이 없습니다.',
                style: TextStyle(fontSize: 16, color: Colors.grey)),
          ],
        ),
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: _requests.length,
      itemBuilder: (context, index) => _buildCard(_requests[index]),
    );
  }

  Widget _buildCard(ReceivedEscortRequestSummary req) {
    final processing = _processing.contains(req.escortId);
    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.06),
            blurRadius: 14,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 22,
                backgroundColor: const Color(0xFF2979FF).withValues(alpha: .12),
                child: const Icon(Icons.person, color: Color(0xFF2979FF)),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('새로운 동행 요청',
                        style: TextStyle(
                            fontSize: 16, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 2),
                    Text(
                      '요청 시각: ${_formatDateTime(req.requestedAt)}',
                      style:
                          const TextStyle(fontSize: 12, color: Colors.grey),
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (req.requestedArchiveItemId != null) ...[
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: const Color(0xFFF5F7FA),
                borderRadius: BorderRadius.circular(10),
              ),
              child: const Row(
                children: [
                  Icon(Icons.bookmark_outline, size: 16, color: Colors.grey),
                  SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      '탐방자가 내가 등록한 동네 지식을 보고 요청했습니다.',
                      style: TextStyle(fontSize: 12, color: Colors.black54),
                    ),
                  ),
                ],
              ),
            ),
          ],
          const SizedBox(height: 16),
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
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => _reject(req),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: Colors.red.shade600,
                      side: BorderSide(color: Colors.red.shade200),
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12)),
                    ),
                    child: const Text('거절'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  flex: 2,
                  child: ElevatedButton(
                    onPressed: () => _accept(req),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF1B8A6B),
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12)),
                    ),
                    child: const Text('수락하기',
                        style: TextStyle(fontWeight: FontWeight.w700)),
                  ),
                ),
              ],
            ),
        ],
      ),
    );
  }

  String _formatDateTime(DateTime dt) {
    final local = dt.toLocal();
    return '${local.month}월 ${local.day}일 ${local.hour.toString().padLeft(2, '0')}:'
        '${local.minute.toString().padLeft(2, '0')}';
  }
}

/// 수락 시 확정할 만남 정보(검증을 통과한 값).
class _MeetingInput {
  const _MeetingInput({
    required this.dateTime,
    this.archiveItemId,
    this.lat,
    this.lng,
  });

  final DateTime dateTime;

  /// 본인 동네 지식으로 장소를 지정한 경우.
  final String? archiveItemId;

  /// 좌표로 직접 지정한 경우(현재 UI에서는 데모 좌표만 사용).
  final double? lat;
  final double? lng;
}

/// 만남 시간(달력+시계)과 장소(본인 동네 지식 목록)를 선택하는 바텀시트.
///
/// 고령 사용자를 고려해 텍스트 직접 입력 없이 날짜/시간 선택기와 카드 목록
/// 클릭만으로 완료할 수 있게 구성한다.
class _MeetingPickerSheet extends StatefulWidget {
  const _MeetingPickerSheet({required this.archiveService});

  final ArchiveService archiveService;

  @override
  State<_MeetingPickerSheet> createState() => _MeetingPickerSheetState();
}

class _MeetingPickerSheetState extends State<_MeetingPickerSheet> {
  /// 데모 위치(서울 시청 인근). 본인 동네 지식이 없을 때의 대체 장소.
  static const double _demoLat = 37.5665;
  static const double _demoLng = 126.978;

  DateTime? _date;
  TimeOfDay? _time;

  bool _loadingItems = true;
  List<ArchiveItemSummary> _myItems = const [];
  String? _selectedItemId;
  bool _useDemoLocation = false;

  @override
  void initState() {
    super.initState();
    _loadMyItems();
  }

  Future<void> _loadMyItems() async {
    try {
      final items = await widget.archiveService.listMine();
      if (!mounted) return;
      setState(() {
        _myItems = items;
        _loadingItems = false;
        // 등록된 동네 지식이 있으면 첫 번째를 기본 선택.
        if (items.isNotEmpty) {
          _selectedItemId = items.first.id;
        } else {
          _useDemoLocation = true;
        }
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loadingItems = false;
        _useDemoLocation = true;
      });
    }
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _date ?? now,
      firstDate: now,
      lastDate: now.add(const Duration(days: 60)),
      helpText: '만남 날짜 선택',
      confirmText: '선택',
      cancelText: '취소',
    );
    if (picked != null) setState(() => _date = picked);
  }

  Future<void> _pickTime() async {
    final picked = await showTimePicker(
      context: context,
      initialTime: _time ?? const TimeOfDay(hour: 10, minute: 0),
      helpText: '만남 시간 선택',
      confirmText: '선택',
      cancelText: '취소',
    );
    if (picked != null) setState(() => _time = picked);
  }

  bool get _canConfirm =>
      _date != null &&
      _time != null &&
      (_selectedItemId != null || _useDemoLocation);

  void _confirm() {
    if (!_canConfirm) return;
    final dt = DateTime(
      _date!.year,
      _date!.month,
      _date!.day,
      _time!.hour,
      _time!.minute,
    );
    Navigator.of(context).pop(
      _MeetingInput(
        dateTime: dt,
        archiveItemId: _useDemoLocation ? null : _selectedItemId,
        lat: _useDemoLocation ? _demoLat : null,
        lng: _useDemoLocation ? _demoLng : null,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      initialChildSize: 0.85,
      minChildSize: 0.5,
      maxChildSize: 0.95,
      expand: false,
      builder: (context, scrollController) {
        return Container(
          decoration: const BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
          ),
          child: Column(
            children: [
              const SizedBox(height: 12),
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: Colors.grey.shade300,
                  borderRadius: BorderRadius.circular(4),
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(20),
                child: Text(
                  '만남 정보 확정',
                  style: Theme.of(context).textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.w800,
                      color: const Color(0xFF1B2D1F)),
                ),
              ),
              Expanded(
                child: ListView(
                  controller: scrollController,
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  children: [
                    _sectionLabel('언제 만날까요?'),
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        Expanded(
                          child: _pickerButton(
                            icon: Icons.calendar_today_rounded,
                            label: _date == null
                                ? '날짜 선택'
                                : '${_date!.month}월 ${_date!.day}일',
                            onTap: _pickDate,
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: _pickerButton(
                            icon: Icons.access_time_rounded,
                            label: _time == null
                                ? '시간 선택'
                                : _time!.format(context),
                            onTap: _pickTime,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 28),
                    _sectionLabel('어디서 만날까요?'),
                    const SizedBox(height: 4),
                    Text(
                      '내가 등록한 동네 지식 장소로 안내할 수 있어요.',
                      style: TextStyle(fontSize: 12, color: Colors.grey.shade500),
                    ),
                    const SizedBox(height: 12),
                    if (_loadingItems)
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 24),
                        child: Center(child: CircularProgressIndicator()),
                      )
                    else ...[
                      ..._myItems.map((item) => _placeCard(item)),
                      _demoLocationCard(),
                    ],
                    const SizedBox(height: 20),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
                child: SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    onPressed: _canConfirm ? _confirm : null,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF1B8A6B),
                      foregroundColor: Colors.white,
                      disabledBackgroundColor: Colors.grey.shade300,
                      padding: const EdgeInsets.symmetric(vertical: 16),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14)),
                    ),
                    child: const Text('수락 확정하기',
                        style: TextStyle(
                            fontSize: 16, fontWeight: FontWeight.w700)),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _sectionLabel(String text) {
    return Text(
      text,
      style: const TextStyle(
          fontSize: 15, fontWeight: FontWeight.w700, color: Color(0xFF1B2D1F)),
    );
  }

  Widget _pickerButton({
    required IconData icon,
    required String label,
    required VoidCallback onTap,
  }) {
    return OutlinedButton.icon(
      onPressed: onTap,
      icon: Icon(icon, color: const Color(0xFF1B8A6B)),
      label: Text(label, style: const TextStyle(fontSize: 15)),
      style: OutlinedButton.styleFrom(
        padding: const EdgeInsets.symmetric(vertical: 16),
        side: BorderSide(color: Colors.grey.shade300),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    );
  }

  Widget _placeCard(ArchiveItemSummary item) {
    final selected = !_useDemoLocation && _selectedItemId == item.id;
    return GestureDetector(
      onTap: () => setState(() {
        _selectedItemId = item.id;
        _useDemoLocation = false;
      }),
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: selected
              ? const Color(0xFF1B8A6B).withValues(alpha: .08)
              : Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: selected
                ? const Color(0xFF1B8A6B)
                : Colors.grey.shade200,
            width: selected ? 2 : 1,
          ),
        ),
        child: Row(
          children: [
            Icon(
              selected
                  ? Icons.radio_button_checked
                  : Icons.radio_button_unchecked,
              color: selected ? const Color(0xFF1B8A6B) : Colors.grey,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    item.category.label,
                    style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: Color(0xFF2979FF)),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    item.body,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 14),
                  ),
                  if (item.dongLabel != null) ...[
                    const SizedBox(height: 2),
                    Text(item.dongLabel!,
                        style: TextStyle(
                            fontSize: 12, color: Colors.grey.shade500)),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _demoLocationCard() {
    final selected = _useDemoLocation;
    return GestureDetector(
      onTap: () => setState(() => _useDemoLocation = true),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: selected
              ? const Color(0xFF1B8A6B).withValues(alpha: .08)
              : Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color:
                selected ? const Color(0xFF1B8A6B) : Colors.grey.shade200,
            width: selected ? 2 : 1,
          ),
        ),
        child: Row(
          children: [
            Icon(
              selected
                  ? Icons.radio_button_checked
                  : Icons.radio_button_unchecked,
              color: selected ? const Color(0xFF1B8A6B) : Colors.grey,
            ),
            const SizedBox(width: 10),
            const Expanded(
              child: Text('그 외 장소(서울 시청 인근 데모 위치)',
                  style: TextStyle(fontSize: 14)),
            ),
          ],
        ),
      ),
    );
  }
}
