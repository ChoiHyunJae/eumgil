import 'package:flutter/material.dart';

import '../services/matching_service.dart';

/// 탐방자가 위치를 입력해 주변 안내자를 검색하고 동행 요청을 보내는 최소 화면.
///
/// 백엔드 searchGuides가 location{lat,lng}(필수)을 요구하므로 위도/경도를 수동
/// 입력받는다(이번 범위는 GPS/지도 제외). 후보별 "요청하기"로 requestEscort를
/// 호출하며, 안내자 수락/거절·만남 확정 UI는 이번 PR 범위가 아니다.
class GuideSearchScreen extends StatefulWidget {
  const GuideSearchScreen({super.key, this.service});

  /// 테스트에서 가짜 구현을 주입하기 위한 선택적 의존성. null이면 기본 생성.
  final MatchingService? service;

  @override
  State<GuideSearchScreen> createState() => _GuideSearchScreenState();
}

class _GuideSearchScreenState extends State<GuideSearchScreen> {
  late final MatchingService _service;

  final _formKey = GlobalKey<FormState>();
  final _latController = TextEditingController();
  final _lngController = TextEditingController();

  bool _loading = false;
  bool _searched = false;
  Object? _error;
  List<GuideCandidateSummary> _candidates = const [];

  /// 요청 처리 중인 guideId 집합(중복 클릭 방지 및 버튼 비활성화용).
  final Set<String> _requesting = <String>{};

  @override
  void initState() {
    super.initState();
    _service = widget.service ?? MatchingService();
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

  String _formatDistance(double distanceM) {
    if (distanceM < 1000) {
      return '약 ${distanceM.round()}m';
    }
    return '${(distanceM / 1000).toStringAsFixed(1)}km';
  }

  Future<void> _search() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _loading = true;
      _error = null;
      _searched = true;
    });
    try {
      final candidates = await _service.searchGuides(
        lat: double.parse(_latController.text.trim()),
        lng: double.parse(_lngController.text.trim()),
      );
      if (!mounted) return;
      setState(() {
        _candidates = candidates;
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

  /// 해당 안내자에게 동행을 요청한다. 같은 guideId 중복 요청은 무시한다.
  Future<void> _request(GuideCandidateSummary candidate) async {
    if (_requesting.contains(candidate.guideId)) return;
    setState(() => _requesting.add(candidate.guideId));
    try {
      await _service.requestEscort(guideId: candidate.guideId);
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('동행을 요청했습니다.')));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('요청에 실패했습니다: $e')));
    } finally {
      if (mounted) {
        setState(() => _requesting.remove(candidate.guideId));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('주변 안내자 찾기')),
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
              child: const Text('검색'),
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
            const Text('안내자를 불러오지 못했습니다.'),
            const SizedBox(height: 12),
            ElevatedButton(onPressed: _search, child: const Text('다시 시도')),
          ],
        ),
      );
    }
    if (!_searched) {
      return const Center(child: Text('위치를 입력하고 검색하세요.'));
    }
    if (_candidates.isEmpty) {
      return const Center(child: Text('주변에 안내자가 없습니다.'));
    }
    return ListView.separated(
      itemCount: _candidates.length,
      separatorBuilder: (_, _) => const Divider(height: 1),
      itemBuilder: (context, index) => _buildItem(_candidates[index]),
    );
  }

  Widget _buildItem(GuideCandidateSummary candidate) {
    final requesting = _requesting.contains(candidate.guideId);
    final distance = _formatDistance(candidate.distanceM);
    final subtitle = candidate.isNewGuide ? '$distance · 신규 안내자' : distance;
    return ListTile(
      title: Text(candidate.displayName),
      subtitle: Text(subtitle),
      trailing: requesting
          ? const SizedBox(
              width: 24,
              height: 24,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : ElevatedButton(
              onPressed: () => _request(candidate),
              child: const Text('요청하기'),
            ),
    );
  }
}
