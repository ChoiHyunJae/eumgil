import 'package:flutter/material.dart';

import '../services/admin_service.dart';

/// 운영자가 승인된 안내자 목록을 보고 자격 상실 처리하는 화면(Slice 5).
///
/// 진입 시 listApprovedGuides로 승인된 안내자를 불러오고, 각 항목을 확인
/// 다이얼로그 뒤 AdminService.reject(userId)로 자격 상실 처리한다.
class ApprovedGuidesScreen extends StatefulWidget {
  const ApprovedGuidesScreen({super.key, this.service});

  /// 테스트에서 가짜 구현을 주입하기 위한 선택적 의존성. null이면 기본 생성.
  final AdminService? service;

  @override
  State<ApprovedGuidesScreen> createState() => _ApprovedGuidesScreenState();
}

class _ApprovedGuidesScreenState extends State<ApprovedGuidesScreen> {
  late final AdminService _service;

  bool _loading = true;
  Object? _error;
  List<ApprovedGuide> _guides = const [];

  /// 처리 중인 userId 집합(중복 클릭 방지 및 버튼 비활성화용).
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
      final guides = await _service.listApprovedGuides();
      if (!mounted) return;
      setState(() {
        _guides = guides;
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

  Future<void> _revoke(ApprovedGuide guide) async {
    if (_processing.contains(guide.userId)) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('자격 상실 처리'),
        content: Text('${guide.userId} 안내자의 승인을 취소할까요?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('취소'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('자격 상실'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() => _processing.add(guide.userId));
    try {
      await _service.reject(guide.userId);
      if (!mounted) return;
      _snack('자격 상실 처리했습니다.');
      setState(() {
        _guides = _guides.where((g) => g.userId != guide.userId).toList();
      });
    } catch (e) {
      if (!mounted) return;
      _snack('처리에 실패했습니다: $e');
    } finally {
      if (mounted) {
        setState(() => _processing.remove(guide.userId));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('승인된 안내자 관리'),
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
            const Text('승인된 안내자를 불러오지 못했습니다.'),
            const SizedBox(height: 12),
            ElevatedButton(onPressed: _load, child: const Text('다시 시도')),
          ],
        ),
      );
    }
    if (_guides.isEmpty) {
      return const Center(child: Text('승인된 안내자가 없습니다.'));
    }
    return ListView.builder(
      itemCount: _guides.length,
      itemBuilder: (context, index) => _buildCard(_guides[index]),
    );
  }

  Widget _buildCard(ApprovedGuide guide) {
    final processing = _processing.contains(guide.userId);
    final parts = <String>[];
    if (guide.residenceYears != null) {
      parts.add('거주 ${guide.residenceYears}년');
    }
    if (guide.interests != null && guide.interests!.isNotEmpty) {
      parts.add('관심: ${guide.interests!.join(', ')}');
    }
    final lines = <Widget>[
      if (guide.phoneNumber != null) Text(guide.phoneNumber!),
      if (parts.isNotEmpty)
        Text(parts.join(' · '), style: const TextStyle(fontSize: 12)),
    ];
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: ListTile(
        title: Text(guide.userId),
        subtitle: lines.isEmpty
            ? null
            : Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: lines,
              ),
        isThreeLine: lines.length > 1,
        trailing: processing
            ? const SizedBox(
                width: 24,
                height: 24,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : OutlinedButton(
                onPressed: () => _revoke(guide),
                child: const Text('자격 상실 처리'),
              ),
      ),
    );
  }
}
