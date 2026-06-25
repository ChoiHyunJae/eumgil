import 'package:flutter/material.dart';

import '../services/admin_service.dart';

/// 운영자가 pending 안내자 신청을 조회·승인·거절하는 최소 관리자 화면.
///
/// initState에서 listPendingGuideApplications를 호출해 목록을 불러오고,
/// 각 신청을 approveGuide/rejectGuide로 처리한 뒤 목록을 새로고침한다.
/// 운영자 권한이 없으면 백엔드가 permission-denied를 반환하며, 에러 상태로 표시된다.
class AdminApprovalScreen extends StatefulWidget {
  const AdminApprovalScreen({super.key, this.service});

  /// 테스트에서 가짜 구현을 주입하기 위한 선택적 의존성. null이면 기본 생성.
  final AdminService? service;

  @override
  State<AdminApprovalScreen> createState() => _AdminApprovalScreenState();
}

class _AdminApprovalScreenState extends State<AdminApprovalScreen> {
  late final AdminService _service;

  bool _loading = true;
  Object? _error;
  List<PendingApplication> _items = const [];

  /// 처리 중인 신청자 userId 집합(중복 클릭 방지 및 버튼 비활성화용).
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
      final items = await _service.listPending();
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

  Future<void> _approve(PendingApplication app) => _review(app, approve: true);

  Future<void> _reject(PendingApplication app) => _review(app, approve: false);

  /// 승인/거절을 처리하고 성공 시 목록을 새로고침한다.
  Future<void> _review(PendingApplication app, {required bool approve}) async {
    setState(() => _processing.add(app.userId));
    try {
      if (approve) {
        await _service.approve(app.userId);
      } else {
        await _service.reject(app.userId);
      }
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(approve ? '승인했습니다.' : '거절했습니다.')));
      await _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('처리에 실패했습니다: $e')));
    } finally {
      if (mounted) {
        setState(() => _processing.remove(app.userId));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('안내자 신청 승인'),
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
            const Text('목록을 불러오지 못했습니다.'),
            const SizedBox(height: 12),
            ElevatedButton(onPressed: _load, child: const Text('다시 시도')),
          ],
        ),
      );
    }
    if (_items.isEmpty) {
      return const Center(child: Text('대기 중인 신청이 없습니다.'));
    }
    return ListView.separated(
      itemCount: _items.length,
      separatorBuilder: (_, _) => const Divider(height: 1),
      itemBuilder: (context, index) => _buildItem(_items[index]),
    );
  }

  Widget _buildItem(PendingApplication app) {
    final busy = _processing.contains(app.userId);
    return ListTile(
      title: Text(app.userId),
      subtitle: Text('신청 ID: ${app.applicationId}'),
      trailing: busy
          ? const SizedBox(
              width: 24,
              height: 24,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextButton(
                  onPressed: () => _approve(app),
                  child: const Text('승인'),
                ),
                TextButton(
                  onPressed: () => _reject(app),
                  child: const Text('거절'),
                ),
              ],
            ),
    );
  }
}
