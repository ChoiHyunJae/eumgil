import 'package:flutter/material.dart';

import '../services/admin_service.dart';

/// 운영자가 신고된 동네 지식을 검토해 숨김/삭제하는 화면(Slice 5).
///
/// 진입 시 listReportedArchiveItems로 신고 목록을 불러오고, 각 항목을
/// hideArchiveItem(숨김) 또는 deleteArchiveItemAsAdmin(삭제, 확인 다이얼로그)로
/// 처리한다. 운영자 권한 검사는 백엔드 assertOperator에 맡긴다.
class ArchiveHideScreen extends StatefulWidget {
  const ArchiveHideScreen({super.key, this.service});

  /// 테스트에서 가짜 구현을 주입하기 위한 선택적 의존성. null이면 기본 생성.
  final AdminService? service;

  @override
  State<ArchiveHideScreen> createState() => _ArchiveHideScreenState();
}

class _ArchiveHideScreenState extends State<ArchiveHideScreen> {
  late final AdminService _service;

  bool _loading = true;
  Object? _error;
  List<ReportedArchiveItem> _items = const [];

  /// 처리 중인 itemId 집합(중복 클릭 방지 및 버튼 비활성화용).
  final Set<String> _processing = <String>{};

  @override
  void initState() {
    super.initState();
    _service = widget.service ?? AdminService();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final items = await _service.listReportedArchiveItems();
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

  void _snack(String message) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _hide(ReportedArchiveItem item) async {
    if (_processing.contains(item.itemId)) return;
    setState(() => _processing.add(item.itemId));
    try {
      await _service.hideArchiveItem(itemId: item.itemId);
      if (!mounted) return;
      _snack('숨김 처리했습니다.');
      await _load();
    } catch (e) {
      if (!mounted) return;
      _snack('숨김 처리에 실패했습니다: $e');
    } finally {
      if (mounted) {
        setState(() => _processing.remove(item.itemId));
      }
    }
  }

  Future<void> _delete(ReportedArchiveItem item) async {
    if (_processing.contains(item.itemId)) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('삭제 확인'),
        content: const Text('이 동네 지식을 영구 삭제할까요? 되돌릴 수 없습니다.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('취소'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('삭제'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() => _processing.add(item.itemId));
    try {
      await _service.deleteArchiveItem(itemId: item.itemId);
      if (!mounted) return;
      _snack('삭제했습니다.');
      setState(() {
        _items = _items.where((i) => i.itemId != item.itemId).toList();
      });
    } catch (e) {
      if (!mounted) return;
      _snack('삭제에 실패했습니다: $e');
    } finally {
      if (mounted) {
        setState(() => _processing.remove(item.itemId));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('신고 동네 지식 검토'),
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
            const Text('신고 목록을 불러오지 못했습니다.'),
            const SizedBox(height: 12),
            ElevatedButton(onPressed: _load, child: const Text('다시 시도')),
          ],
        ),
      );
    }
    if (_items.isEmpty) {
      return const Center(child: Text('검토할 신고 항목이 없습니다.'));
    }
    return ListView.builder(
      itemCount: _items.length,
      itemBuilder: (context, index) => _buildCard(_items[index]),
    );
  }

  Widget _buildCard(ReportedArchiveItem item) {
    final processing = _processing.contains(item.itemId);
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Chip(label: Text(item.category)),
                const SizedBox(width: 8),
                Text('신고 ${item.reportCount}건'),
                if (item.hidden) ...[
                  const SizedBox(width: 8),
                  const Chip(label: Text('숨김')),
                ],
              ],
            ),
            const SizedBox(height: 8),
            Text(item.body),
            if (item.dongLabel != null) ...[
              const SizedBox(height: 4),
              Text(item.dongLabel!, style: const TextStyle(fontSize: 12)),
            ],
            const SizedBox(height: 4),
            Text('작성자: ${item.authorId}', style: const TextStyle(fontSize: 12)),
            const SizedBox(height: 8),
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
                    onPressed: () => _hide(item),
                    child: const Text('숨김 처리'),
                  ),
                  const SizedBox(width: 8),
                  ElevatedButton(
                    onPressed: () => _delete(item),
                    child: const Text('삭제'),
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }
}
