import 'package:flutter/material.dart';

import '../services/archive_service.dart';

/// 승인된 안내자가 동네 지식을 등록하는 최소 입력 폼 화면.
///
/// 백엔드 createArchiveItem이 voiceTranscript(필수)와 location{lat,lng}(필수)을
/// 요구하므로, 분류·내용·좌표를 입력받아 호출한다. 성공 시 완료 메시지를 띄우고
/// 이전 화면으로 돌아간다(Navigator.pop). 지도/사진 첨부는 이번 범위에서 제외.
class ArchiveCreateScreen extends StatefulWidget {
  const ArchiveCreateScreen({super.key, this.service});

  /// 테스트에서 가짜 구현을 주입하기 위한 선택적 의존성. null이면 기본 생성.
  final ArchiveService? service;

  @override
  State<ArchiveCreateScreen> createState() => _ArchiveCreateScreenState();
}

class _ArchiveCreateScreenState extends State<ArchiveCreateScreen> {
  late final ArchiveService _service;

  final _formKey = GlobalKey<FormState>();
  final _contentController = TextEditingController();
  final _latController = TextEditingController();
  final _lngController = TextEditingController();

  ArchiveCategory _category = ArchiveCategory.place;
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    _service = widget.service ?? ArchiveService();
  }

  @override
  void dispose() {
    _contentController.dispose();
    _latController.dispose();
    _lngController.dispose();
    super.dispose();
  }

  String? _validateRequired(String? value) {
    if (value == null || value.trim().isEmpty) {
      return '필수 입력 항목입니다.';
    }
    return null;
  }

  String? _validateCoordinate(String? value) {
    final required = _validateRequired(value);
    if (required != null) return required;
    if (double.tryParse(value!.trim()) == null) {
      return '숫자를 입력하세요.';
    }
    return null;
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _submitting = true);
    try {
      await _service.createArchiveItem(
        category: _category,
        voiceTranscript: _contentController.text.trim(),
        lat: double.parse(_latController.text.trim()),
        lng: double.parse(_lngController.text.trim()),
      );
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('동네 지식이 등록되었습니다.')));
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _submitting = false);
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('등록에 실패했습니다: $e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('동네 지식 등록')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              DropdownButtonFormField<ArchiveCategory>(
                initialValue: _category,
                decoration: const InputDecoration(labelText: '분류'),
                items: const [
                  DropdownMenuItem(
                    value: ArchiveCategory.place,
                    child: Text('장소'),
                  ),
                  DropdownMenuItem(
                    value: ArchiveCategory.walk,
                    child: Text('산책로'),
                  ),
                  DropdownMenuItem(
                    value: ArchiveCategory.other,
                    child: Text('기타'),
                  ),
                ],
                onChanged: _submitting
                    ? null
                    : (value) {
                        if (value != null) setState(() => _category = value);
                      },
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _contentController,
                decoration: const InputDecoration(
                  labelText: '내용',
                  hintText: '동네 지식 내용을 입력하세요.',
                ),
                minLines: 3,
                maxLines: 6,
                validator: _validateRequired,
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _latController,
                decoration: const InputDecoration(labelText: '위도(lat)'),
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                  signed: true,
                ),
                validator: _validateCoordinate,
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _lngController,
                decoration: const InputDecoration(labelText: '경도(lng)'),
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                  signed: true,
                ),
                validator: _validateCoordinate,
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
                    : const Text('등록'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
