import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';

import '../services/matching_service.dart';

/// 탐방자가 현재 위치 기준 1km 내 안내자를 탐색하고 동행을 요청하는 화면.
///
/// 화면 진입 시 GPS 위치를 자동으로 요청하고, 허용되면 바로 검색한다.
/// 거부 시 데모 좌표(서울 시청 인근)를 사용해 검색할 수 있다.
class GuideSearchScreen extends StatefulWidget {
  const GuideSearchScreen({super.key, this.service});

  final MatchingService? service;

  @override
  State<GuideSearchScreen> createState() => _GuideSearchScreenState();
}

class _GuideSearchScreenState extends State<GuideSearchScreen> {
  late final MatchingService _service;

  /// 에뮬레이터 데모 위치 (서울 시청 인근 — 시드 안내자 위치와 동일).
  static const double _demoLat = 37.5665;
  static const double _demoLng = 126.978;

  bool _loading = false;
  bool _searched = false;
  Object? _error;
  List<GuideCandidateSummary> _candidates = const [];
  final Set<String> _requesting = <String>{};
  String _locationLabel = '위치 확인 중...';

  @override
  void initState() {
    super.initState();
    _service = widget.service ?? MatchingService();
    _initLocationAndSearch();
  }

  Future<void> _initLocationAndSearch() async {
    try {
      final position = await _requestLocation();
      setState(() => _locationLabel =
          '현재 위치 기준 (${position.latitude.toStringAsFixed(4)}, '
          '${position.longitude.toStringAsFixed(4)})');
      await _searchAt(position.latitude, position.longitude);
    } catch (_) {
      setState(() => _locationLabel = '데모 위치 기준 (서울 시청 인근)');
      await _searchAt(_demoLat, _demoLng);
    }
  }

  Future<Position> _requestLocation() async {
    LocationPermission permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied ||
        permission == LocationPermission.deniedForever) {
      throw Exception('위치 권한 거부');
    }
    return Geolocator.getCurrentPosition(
      locationSettings:
          const LocationSettings(accuracy: LocationAccuracy.medium),
    );
  }

  Future<void> _searchAt(double lat, double lng) async {
    setState(() {
      _loading = true;
      _error = null;
      _searched = true;
    });
    try {
      final candidates = await _service.searchGuides(lat: lat, lng: lng);
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

  String _formatDistance(double m) =>
      m < 1000 ? '${m.round()}m 이내' : '${(m / 1000).toStringAsFixed(1)}km';

  Future<void> _requestEscort(GuideCandidateSummary candidate) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        shape:
            RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: const Text('동행 요청'),
        content: const Text(
          '이 안내자에게 동행을 요청할까요?\n\n'
          '요청 후 48시간 내에 수락하지 않으면 자동으로 만료됩니다.',
          style: TextStyle(height: 1.6),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('취소'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, true),
            style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF2979FF)),
            child: const Text('요청하기'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    if (_requesting.contains(candidate.guideId)) return;

    setState(() => _requesting.add(candidate.guideId));
    try {
      await _service.requestEscort(guideId: candidate.guideId);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('동행을 요청했습니다. 안내자의 수락을 기다려 주세요.'),
          backgroundColor: const Color(0xFF1B8A6B),
          behavior: SnackBarBehavior.floating,
          shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12)),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('요청에 실패했습니다: $e'),
          backgroundColor: Colors.red.shade700,
          behavior: SnackBarBehavior.floating,
          shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12)),
        ),
      );
    } finally {
      if (mounted) setState(() => _requesting.remove(candidate.guideId));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        _buildLocationBanner(),
        Expanded(child: _buildBody()),
      ],
    );
  }

  Widget _buildLocationBanner() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      color: const Color(0xFF2979FF).withValues(alpha: 0.08),
      child: Row(
        children: [
          const Icon(Icons.location_on, color: Color(0xFF2979FF), size: 18),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              _locationLabel,
              style: const TextStyle(
                fontSize: 13,
                color: Color(0xFF2979FF),
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
          if (!_loading)
            TextButton(
              onPressed: _initLocationAndSearch,
              child: const Text('새로고침',
                  style:
                      TextStyle(fontSize: 12, color: Color(0xFF2979FF))),
            ),
        ],
      ),
    );
  }

  Widget _buildBody() {
    if (_loading) {
      return const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircularProgressIndicator(color: Color(0xFF2979FF)),
            SizedBox(height: 16),
            Text('주변 안내자를 찾고 있어요...',
                style: TextStyle(color: Colors.grey)),
          ],
        ),
      );
    }
    if (_error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.search_off, size: 56, color: Colors.grey.shade300),
            const SizedBox(height: 16),
            const Text('안내자를 불러오지 못했습니다.',
                style: TextStyle(fontSize: 16, color: Colors.grey)),
            const SizedBox(height: 12),
            ElevatedButton.icon(
              onPressed: _initLocationAndSearch,
              icon: const Icon(Icons.refresh),
              label: const Text('다시 시도'),
              style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF2979FF)),
            ),
          ],
        ),
      );
    }
    if (!_searched) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_candidates.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.person_search, size: 64, color: Colors.grey.shade300),
            const SizedBox(height: 16),
            const Text('주변 1km 내에 안내자가 없어요.',
                style: TextStyle(fontSize: 16, color: Colors.grey)),
            const SizedBox(height: 8),
            Text('조금 후에 다시 시도해 보세요.',
                style: TextStyle(
                    fontSize: 13, color: Colors.grey.shade400)),
          ],
        ),
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: _candidates.length,
      itemBuilder: (_, i) => _buildGuideCard(_candidates[i]),
    );
  }

  Widget _buildGuideCard(GuideCandidateSummary candidate) {
    final requesting = _requesting.contains(candidate.guideId);

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.06),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                CircleAvatar(
                  radius: 24,
                  backgroundColor:
                      const Color(0xFF2979FF).withValues(alpha: 0.12),
                  child: const Icon(Icons.directions_walk_rounded,
                      color: Color(0xFF2979FF), size: 24),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          const Text(
                            '안내자',
                            style: TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.w700,
                                color: Color(0xFF1B2D1F)),
                          ),
                          const SizedBox(width: 8),
                          if (candidate.isNewGuide)
                            Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 8, vertical: 2),
                              decoration: BoxDecoration(
                                color: const Color(0xFF1B8A6B)
                                    .withValues(alpha: 0.1),
                                borderRadius: BorderRadius.circular(20),
                              ),
                              child: const Text('신규',
                                  style: TextStyle(
                                      fontSize: 11,
                                      color: Color(0xFF1B8A6B),
                                      fontWeight: FontWeight.w600)),
                            ),
                        ],
                      ),
                      const SizedBox(height: 2),
                      Row(
                        children: [
                          const Icon(Icons.location_on_outlined,
                              size: 14, color: Colors.grey),
                          const SizedBox(width: 2),
                          Text(
                            _formatDistance(candidate.distanceM),
                            style: const TextStyle(
                                fontSize: 13, color: Colors.grey),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed:
                    requesting ? null : () => _requestEscort(candidate),
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF2979FF),
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12)),
                ),
                child: requesting
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white),
                      )
                    : const Text('동행 요청하기',
                        style: TextStyle(
                            fontSize: 15, fontWeight: FontWeight.w600)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
