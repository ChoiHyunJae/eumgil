import 'package:flutter/material.dart';

import '../services/guide_service.dart';
import 'archive_create_screen.dart';
import 'received_escort_requests_screen.dart';

/// 동네 지식 탭에서 안내자 신청 상태에 따라 UI를 분기하는 위젯.
///
/// initState에서 getMyGuideApplicationStatus를 호출해 상태를 조회하고,
/// none/pending/approved/rejected에 따라 버튼/표시를 다르게 렌더링한다.
/// 신청(applyForGuide) 성공 시 즉시 pending 상태로 갱신한다.
class GuideStatusView extends StatefulWidget {
  const GuideStatusView({super.key, this.service});

  /// 테스트에서 가짜 구현을 주입하기 위한 선택적 의존성. null이면 기본 생성.
  final GuideService? service;

  @override
  State<GuideStatusView> createState() => _GuideStatusViewState();
}

class _GuideStatusViewState extends State<GuideStatusView> {
  late final GuideService _service;

  bool _loading = true;
  bool _submitting = false;
  Object? _error;
  GuideStatusResult? _result;

  @override
  void initState() {
    super.initState();
    _service = widget.service ?? GuideService();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await _service.getMyStatus();
      if (!mounted) return;
      setState(() {
        _result = result;
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

  /// 안내자 신청을 제출하고, 성공하면 pending 상태로 갱신한다.
  Future<void> _apply() async {
    setState(() => _submitting = true);
    try {
      await _service.applyForGuide();
      if (!mounted) return;
      setState(() {
        _result = const GuideStatusResult(
          status: GuideApplicationViewStatus.pending,
        );
        _submitting = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _submitting = false);
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('신청에 실패했습니다: $e')));
    }
  }

  /// 동네 지식 등록 화면으로 이동한다(approved 상태 전용).
  Future<void> _openArchiveCreate() async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => const ArchiveCreateScreen()),
    );
  }

  /// 받은 동행 요청 화면으로 이동한다(approved 상태 전용).
  Future<void> _openReceivedRequests() async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => const ReceivedEscortRequestsScreen(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null) {
      return _buildError();
    }
    return Center(child: _buildForStatus(_result!.status));
  }

  Widget _buildError() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text('상태를 불러오지 못했습니다.'),
          const SizedBox(height: 12),
          ElevatedButton(onPressed: _load, child: const Text('다시 시도')),
        ],
      ),
    );
  }

  Widget _buildForStatus(GuideApplicationViewStatus status) {
    switch (status) {
      case GuideApplicationViewStatus.none:
        return ElevatedButton(
          onPressed: _submitting ? null : _apply,
          child: const Text('안내자 신청하기'),
        );
      case GuideApplicationViewStatus.pending:
        return const Text('신청 대기 중');
      case GuideApplicationViewStatus.approved:
        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ElevatedButton(
              onPressed: _openArchiveCreate,
              child: const Text('등록하기'),
            ),
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: _openReceivedRequests,
              child: const Text('받은 동행 요청 보기'),
            ),
          ],
        );
      case GuideApplicationViewStatus.rejected:
        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('거절됨 / 재신청 가능'),
            const SizedBox(height: 12),
            ElevatedButton(
              onPressed: _submitting ? null : _apply,
              child: const Text('재신청'),
            ),
          ],
        );
    }
  }
}
