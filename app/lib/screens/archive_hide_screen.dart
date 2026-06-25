import 'package:flutter/material.dart';

import '../services/admin_service.dart';

/// 운영자가 신고된 동네 지식을 숨김 처리하는 최소 화면.
///
/// 신고된 항목 목록을 조회하는 백엔드 callable이 없으므로, 운영자가 itemId를
/// 직접 입력해 hideArchiveItem을 호출한다. 운영자 권한 검사는 백엔드
/// assertOperator에 위임하며, 권한이 없으면 permission-denied로 실패한다.
class ArchiveHideScreen extends StatefulWidget {
  const ArchiveHideScreen({super.key, this.service});

  /// 테스트에서 가짜 구현을 주입하기 위한 선택적 의존성. null이면 기본 생성.
  final AdminService? service;

  @override
  State<ArchiveHideScreen> createState() => _ArchiveHideScreenState();
}

class _ArchiveHideScreenState extends State<ArchiveHideScreen> {
  late final AdminService _service;

  final _formKey = GlobalKey<FormState>();
  final _itemIdController = TextEditingController();
  final _reasonController = TextEditingController();

  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    _service = widget.service ?? AdminService();
  }

  @override
  void dispose() {
    _itemIdController.dispose();
    _reasonController.dispose();
    super.dispose();
  }

  String? _validateItemId(String? value) {
    if (value == null || value.trim().isEmpty) {
      return 'itemId는 필수 입력 항목입니다.';
    }
    return null;
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _submitting = true);
    try {
      await _service.hideArchiveItem(
        itemId: _itemIdController.text.trim(),
        reason: _reasonController.text,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('숨김 처리되었습니다.')));
      _itemIdController.clear();
      _reasonController.clear();
      setState(() => _submitting = false);
    } catch (e) {
      if (!mounted) return;
      setState(() => _submitting = false);
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('숨김 처리에 실패했습니다: $e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('동네 지식 숨김 처리')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextFormField(
                controller: _itemIdController,
                decoration: const InputDecoration(
                  labelText: 'itemId',
                  hintText: '숨길 동네 지식의 문서 id',
                ),
                validator: _validateItemId,
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _reasonController,
                decoration: const InputDecoration(
                  labelText: '사유(선택)',
                  hintText: '숨김 사유를 입력하세요.',
                ),
                minLines: 2,
                maxLines: 4,
              ),
              const SizedBox(height: 24),
              ElevatedButton(
                onPressed: _submitting ? null : _submit,
                child: _submitting
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('숨김 처리'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
