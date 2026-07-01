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
  Future<void> _requestFromItem(ArchiveItemSummary item) async {
    if (_requesting.contains(item.id)) return;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        shape:
            RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: const Text('안내 요청'),
        content: const Text(
          '이 곳을 직접 보고 설명을 듣고 싶으신가요?\n'
          '이 동네 지식을 등록한 안내자에게 동행을 요청합니다.',
          style: TextStyle(height: 1.6),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('취소'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, true),
            style:
                ElevatedButton.styleFrom(backgroundColor: const Color(0xFF2979FF)),
            child: const Text('요청하기'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() => _requesting.add(item.id));
    try {
      await _matchingService.requestEscort(
        guideId: item.authorId,
        archiveItemId: item.id,
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
