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
    return ListTile(
      leading: Chip(label: Text(item.category.label)),
      title: Text(item.body),
      subtitle: item.dongLabel == null ? null : Text(item.dongLabel!),
      isThreeLine: item.dongLabel != null,
    );
  }
}
