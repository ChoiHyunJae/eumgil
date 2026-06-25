import 'package:flutter/material.dart';

import '../services/archive_service.dart';

/// 사용자가 주변 동네 지식 목록을 조회하는 최소 화면.
///
/// 백엔드 listNearbyArchiveItems가 location{lat,lng}(필수)을 요구하므로
/// 위도/경도를 수동 입력받아 조회한다(이번 범위는 GPS/지도 제외). 결과는
/// 카테고리·본문·위치 표시값(dongLabel)만 노출한다(정확 좌표는 응답에 없음).
class ArchiveListScreen extends StatefulWidget {
  const ArchiveListScreen({super.key, this.service});

  /// 테스트에서 가짜 구현을 주입하기 위한 선택적 의존성. null이면 기본 생성.
  final ArchiveService? service;

  @override
  State<ArchiveListScreen> createState() => _ArchiveListScreenState();
}

class _ArchiveListScreenState extends State<ArchiveListScreen> {
  late final ArchiveService _service;

  final _formKey = GlobalKey<FormState>();
  final _latController = TextEditingController();
  final _lngController = TextEditingController();

  bool _loading = false;
  bool _searched = false;
  Object? _error;
  List<ArchiveItemSummary> _items = const [];

  /// 신고 처리 중인 itemId 집합(중복 클릭 방지 및 버튼 비활성화용).
  final Set<String> _reporting = <String>{};

  @override
  void initState() {
    super.initState();
    _service = widget.service ?? ArchiveService();
  }

  @override
  void dispose() {
    _latController.dispose();
    _lngController.dispose();
    super.dispose();
  }

  String? _validateCoordinate(String? value) {
    if (value == null || value.trim().isEmpty) {
      return '필수 입력 항목입니다.';
    }
    if (double.tryParse(value.trim()) == null) {
      return '숫자를 입력하세요.';
    }
    return null;
  }

  Future<void> _search() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _loading = true;
      _error = null;
      _searched = true;
    });
    try {
      final items = await _service.listNearby(
        lat: double.parse(_latController.text.trim()),
        lng: double.parse(_lngController.text.trim()),
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
      appBar: AppBar(title: const Text('주변 동네 지식')),
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
      child: Form(
        key: _formKey,
        child: Row(
          children: [
            Expanded(
              child: TextFormField(
                controller: _latController,
                decoration: const InputDecoration(labelText: '위도(lat)'),
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                  signed: true,
                ),
                validator: _validateCoordinate,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: TextFormField(
                controller: _lngController,
                decoration: const InputDecoration(labelText: '경도(lng)'),
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                  signed: true,
                ),
                validator: _validateCoordinate,
              ),
            ),
            const SizedBox(width: 12),
            ElevatedButton(
              onPressed: _loading ? null : _search,
              child: const Text('조회'),
            ),
          ],
        ),
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
      return const Center(child: Text('위치를 입력하고 조회하세요.'));
    }
    if (_items.isEmpty) {
      return const Center(child: Text('주변에 등록된 동네 지식이 없습니다.'));
    }
    return ListView.separated(
      itemCount: _items.length,
      separatorBuilder: (_, _) => const Divider(height: 1),
      itemBuilder: (context, index) => _buildItem(_items[index]),
    );
  }

  Widget _buildItem(ArchiveItemSummary item) {
    final reporting = _reporting.contains(item.id);
    return ListTile(
      leading: Chip(label: Text(item.category.label)),
      title: Text(item.body),
      subtitle: item.dongLabel == null ? null : Text(item.dongLabel!),
      isThreeLine: item.dongLabel != null,
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
    );
  }

  /// 신고 사유 입력 다이얼로그를 띄우고, 확인 시 신고를 진행한다.
  Future<void> _onReportPressed(ArchiveItemSummary item) async {
    final reason = await showDialog<String?>(
      context: context,
      builder: (_) => const _ReportReasonDialog(),
    );
    // 다이얼로그를 취소하면 null이 반환된다(빈 사유 확인은 빈 문자열).
    if (reason == null || !mounted) return;
    await _report(item, reason);
  }

  /// reportArchiveItem을 호출한다. 동일 itemId의 중복 신고는 무시한다.
  Future<void> _report(ArchiveItemSummary item, String reason) async {
    if (_reporting.contains(item.id)) return;
    setState(() => _reporting.add(item.id));
    try {
      await _service.report(itemId: item.id, reason: reason);
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('신고가 접수되었습니다.')));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('신고에 실패했습니다: $e')));
    } finally {
      if (mounted) {
        setState(() => _reporting.remove(item.id));
      }
    }
  }
}

/// 신고 사유(선택)를 입력받는 다이얼로그. "신고"는 입력값을, "취소"는 null을 반환한다.
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
