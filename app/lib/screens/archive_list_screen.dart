import 'package:flutter/material.dart';

import '../services/archive_service.dart';
import '../services/matching_service.dart';

/// 동네 지식 목록 조회 화면.
///
/// 동 단위 드롭다운으로 지역을 선택해 해당 동의 동네 지식 목록을 조회한다.
class ArchiveListScreen extends StatefulWidget {
  const ArchiveListScreen({
    super.key,
    this.service,
    this.matchingService,
    this.showRequestButton = false,
  });

  /// 테스트에서 가짜 구현을 주입하기 위한 선택적 의존성. null이면 기본 생성.
  final ArchiveService? service;

  /// "이 곳 안내 요청하기" 버튼에서 쓸 매칭 서비스(테스트용 주입).
  final MatchingService? matchingService;

  /// true면 각 카드에 "이 곳 안내 요청하기" 버튼을 노출한다(탐방자 전용 화면에서 사용).
  final bool showRequestButton;

  @override
  State<ArchiveListScreen> createState() => _ArchiveListScreenState();
}

class _ArchiveListScreenState extends State<ArchiveListScreen> {
  late final ArchiveService _service;
  late final MatchingService _matchingService;

  String? _selectedDong;
  ArchiveCategory? _selectedCategory;
  List<String> _availableDongs = const [];
  bool _loadingDongs = true;

  bool _loading = false;
  bool _searched = false;
  Object? _error;
  List<ArchiveItemSummary> _items = const [];

  /// 신고 처리 중인 itemId 집합(중복 클릭 방지).
  final Set<String> _reporting = <String>{};

  /// 동행 요청 처리 중인 itemId 집합(중복 클릭 방지).
  final Set<String> _requesting = <String>{};

  @override
  void initState() {
    super.initState();
    _service = widget.service ?? ArchiveService();
    _matchingService = widget.matchingService ?? MatchingService();
    _loadDongs();
  }

  /// 이 동네 지식을 보고 작성 안내자에게 동행을 요청한다.
  /// 원하는 만남 시간을 먼저 선택(달력/시계)해서 함께 제안할 수 있다.
  /// 바텀시트가 취소(뒤로가기/바깥 탭)로 닫히면 요청을 진행하지 않는다.
  Future<void> _requestFromItem(ArchiveItemSummary item) async {
    if (_requesting.contains(item.id)) return;

    final result = await showModalBottomSheet<_ProposeTimeResult>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _ProposeTimeSheet(itemTitle: item.body),
    );
    if (result == null || !mounted) return; // 취소됨

    setState(() => _requesting.add(item.id));
    try {
      await _matchingService.requestEscort(
        guideId: item.authorId,
        archiveItemId: item.id,
        proposedMeetingTime: result.dateTime,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('안내자에게 동행을 요청했습니다.'),
          backgroundColor: const Color(0xFF1B8A6B),
          behavior: SnackBarBehavior.floating,
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('요청에 실패했습니다: $e'),
          backgroundColor: Colors.red.shade700,
          behavior: SnackBarBehavior.floating,
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
      );
    } finally {
      if (mounted) setState(() => _requesting.remove(item.id));
    }
  }

  Future<void> _loadDongs() async {
    try {
      final dongs = await _service.getAvailableDongs();
      if (!mounted) return;
      setState(() {
        _availableDongs = dongs;
        _loadingDongs = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _loadingDongs = false);
    }
  }

  Future<void> _search() async {
    if (_selectedDong == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('동네(지역)를 선택해 주세요.')),
      );
      return;
    }

    setState(() {
      _loading = true;
      _error = null;
      _searched = true;
    });
    try {
      final items = await _service.listByDong(
        dong: _selectedDong!,
        category: _selectedCategory,
      );
      if (!mounted) return;
      setState(() {
        _items = items;
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('동네 지식 찾기')),
      body: Column(
        children: [
          _buildSearchForm(),
          const Divider(height: 1),
          Expanded(child: _buildResult()),
        ],
      ),
    );
  }

  Widget _buildSearchForm() {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // 동 단위 드롭다운
          _loadingDongs
              ? const Center(child: CircularProgressIndicator())
              : DropdownButtonFormField<String>(
                  initialValue: _selectedDong,
                  decoration: const InputDecoration(
                    labelText: '동네(지역) 선택',
                    hintText: '찾을 동네를 선택하세요',
                    isDense: true,
                  ),
                  items: _availableDongs
                      .map((d) => DropdownMenuItem(value: d, child: Text(d)))
                      .toList(),
                  onChanged: (v) => setState(() => _selectedDong = v),
                ),
          const SizedBox(height: 8),
          // 카테고리 필터 + 조회 버튼
          Row(
            children: [
              Expanded(
                child: DropdownButtonFormField<ArchiveCategory?>(
                  initialValue: _selectedCategory,
                  decoration: const InputDecoration(
                    labelText: '분류 (전체)',
                    isDense: true,
                  ),
                  items: [
                    const DropdownMenuItem(value: null, child: Text('전체')),
                    ...ArchiveCategory.values.map(
                      (c) => DropdownMenuItem(
                        value: c,
                        child: Text(c.label),
                      ),
                    ),
                  ],
                  onChanged: (v) => setState(() => _selectedCategory = v),
                ),
              ),
              const SizedBox(width: 12),
              ElevatedButton(
                onPressed: _loading ? null : _search,
                child: const Text('조회'),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildResult() {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('목록을 불러오지 못했습니다.'),
            const SizedBox(height: 12),
            ElevatedButton(onPressed: _search, child: const Text('다시 시도')),
          ],
        ),
      );
    }
    if (!_searched) {
      return const Center(child: Text('동네를 선택하고 조회하세요.'));
    }
    if (_items.isEmpty) {
      return const Center(child: Text('해당 동네에 등록된 동네 지식이 없습니다.'));
    }
    return ListView.separated(
      itemCount: _items.length,
      separatorBuilder: (_, _) => const Divider(height: 1),
      itemBuilder: (context, index) => _buildItem(_items[index]),
    );
  }

  String? _authorProfileLine(ArchiveItemSummary item) {
    final parts = <String>[];
    if (item.residenceYears != null) parts.add('거주 ${item.residenceYears}년');
    if (item.interests != null && item.interests!.isNotEmpty) {
      parts.add('관심: ${item.interests!.join(', ')}');
    }
    return parts.isEmpty ? null : parts.join(' · ');
  }

  Widget _buildItem(ArchiveItemSummary item) {
    final reporting = _reporting.contains(item.id);
    final requesting = _requesting.contains(item.id);
    final profileLine = _authorProfileLine(item);
    final subtitleLines = <Widget>[
      if (item.dongLabel != null) Text(item.dongLabel!),
      if (profileLine != null)
        Text(profileLine, style: const TextStyle(fontSize: 12)),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ListTile(
          leading: Chip(label: Text(item.category.label)),
          title: Text(item.body),
          subtitle: subtitleLines.isEmpty
              ? null
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: subtitleLines,
                ),
          isThreeLine: subtitleLines.length > 1,
          trailing: reporting
              ? const SizedBox(
                  width: 24,
                  height: 24,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : IconButton(
                  icon: const Icon(Icons.outlined_flag),
                  tooltip: '신고',
                  onPressed: () => _onReportPressed(item),
                ),
        ),
        if (widget.showRequestButton)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
            child: SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: requesting ? null : () => _requestFromItem(item),
                icon: requesting
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.directions_walk, size: 18),
                label: const Text('이 곳 안내 요청하기'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: const Color(0xFF2979FF),
                  side: const BorderSide(color: Color(0xFF2979FF)),
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12)),
                ),
              ),
            ),
          ),
      ],
    );
  }

  Future<void> _onReportPressed(ArchiveItemSummary item) async {
    final reason = await showDialog<String?>(
      context: context,
      builder: (_) => const _ReportReasonDialog(),
    );
    if (reason == null || !mounted) return;
    await _report(item, reason);
  }

  Future<void> _report(ArchiveItemSummary item, String reason) async {
    if (_reporting.contains(item.id)) return;
    setState(() => _reporting.add(item.id));
    try {
      await _service.report(itemId: item.id, reason: reason);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('신고가 접수되었습니다.')),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('신고에 실패했습니다: $e')),
      );
    } finally {
      if (mounted) setState(() => _reporting.remove(item.id));
    }
  }
}

class _ReportReasonDialog extends StatefulWidget {
  const _ReportReasonDialog();

  @override
  State<_ReportReasonDialog> createState() => _ReportReasonDialogState();
}

class _ReportReasonDialogState extends State<_ReportReasonDialog> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('신고'),
      content: TextField(
        controller: _controller,
        decoration: const InputDecoration(
          labelText: '신고 사유(선택)',
          hintText: '신고 사유를 입력하세요.',
        ),
        minLines: 2,
        maxLines: 4,
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('취소'),
        ),
        TextButton(
          onPressed: () => Navigator.of(context).pop(_controller.text),
          child: const Text('신고'),
        ),
      ],
    );
  }
}

/// 동네 지식 기반 요청 시 선택한 만남 시간(시간 선택 안 함도 허용).
class _ProposeTimeResult {
  const _ProposeTimeResult({this.dateTime});

  /// 탐방자가 제안하는 만남 시간. 선택하지 않으면 null(안내자가 정하도록 위임).
  final DateTime? dateTime;
}

/// 탐방자가 동네 지식을 보고 요청할 때 원하는 만남 시간을 먼저 선택하는
/// 바텀시트. 고령 사용자를 고려해 달력/시계 선택만 사용하고, 시간을 정하지
/// 않고도 요청을 진행할 수 있게 한다.
class _ProposeTimeSheet extends StatefulWidget {
  const _ProposeTimeSheet({required this.itemTitle});

  final String itemTitle;

  @override
  State<_ProposeTimeSheet> createState() => _ProposeTimeSheetState();
}

class _ProposeTimeSheetState extends State<_ProposeTimeSheet> {
  DateTime? _date;
  TimeOfDay? _time;

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _date ?? now,
      firstDate: now,
      lastDate: now.add(const Duration(days: 60)),
      helpText: '희망 만남 날짜 선택',
      confirmText: '선택',
      cancelText: '취소',
    );
    if (picked != null) setState(() => _date = picked);
  }

  Future<void> _pickTime() async {
    final picked = await showTimePicker(
      context: context,
      initialTime: _time ?? const TimeOfDay(hour: 10, minute: 0),
      helpText: '희망 만남 시간 선택',
      confirmText: '선택',
      cancelText: '취소',
    );
    if (picked != null) setState(() => _time = picked);
  }

  bool get _hasSelection => _date != null && _time != null;

  void _confirmWithTime() {
    if (!_hasSelection) return;
    Navigator.of(context).pop(
      _ProposeTimeResult(
        dateTime: DateTime(
          _date!.year,
          _date!.month,
          _date!.day,
          _time!.hour,
          _time!.minute,
        ),
      ),
    );
  }

  void _confirmWithoutTime() {
    Navigator.of(context).pop(const _ProposeTimeResult());
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.only(
        bottom: MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
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
            padding: const EdgeInsets.fromLTRB(20, 20, 20, 4),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(
                '언제 만나고 싶으세요?',
                style: Theme.of(context)
                    .textTheme
                    .titleLarge
                    ?.copyWith(fontWeight: FontWeight.w800),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(
                '"${widget.itemTitle}"에 대한 안내를 요청합니다.\n'
                '희망 시간은 선택 사항이며, 정하지 않아도 요청할 수 있어요.',
                style: TextStyle(fontSize: 12, color: Colors.grey.shade600, height: 1.5),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
            child: Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _pickDate,
                    icon: const Icon(Icons.calendar_today_rounded,
                        color: Color(0xFF2979FF)),
                    label: Text(
                      _date == null
                          ? '날짜 선택'
                          : '${_date!.month}월 ${_date!.day}일',
                    ),
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 16),
                      side: BorderSide(color: Colors.grey.shade300),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12)),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _pickTime,
                    icon: const Icon(Icons.access_time_rounded,
                        color: Color(0xFF2979FF)),
                    label: Text(
                      _time == null ? '시간 선택' : _time!.format(context),
                    ),
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 16),
                      side: BorderSide(color: Colors.grey.shade300),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12)),
                    ),
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 0),
            child: SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: _hasSelection ? _confirmWithTime : null,
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF2979FF),
                  foregroundColor: Colors.white,
                  disabledBackgroundColor: Colors.grey.shade300,
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14)),
                ),
                child: const Text('이 시간으로 요청하기',
                    style:
                        TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 0),
            child: SizedBox(
              width: double.infinity,
              child: TextButton(
                onPressed: _confirmWithoutTime,
                child: const Text(
                  '시간은 나중에 정할게요',
                  style: TextStyle(color: Colors.grey),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
