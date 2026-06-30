import 'package:flutter/material.dart';

import '../services/archive_service.dart';

/// 승인된 안내자가 동네 지식을 등록하는 입력 폼 화면.
///
/// 동 단위 드롭다운으로 위치를 선택하고, 카테고리·경험담 내용을 입력해
/// createArchiveItem을 호출한다.
class ArchiveCreateScreen extends StatefulWidget {
  const ArchiveCreateScreen({super.key, this.service});

  /// 테스트에서 가짜 구현을 주입하기 위한 선택적 의존성. null이면 기본 생성.
  final ArchiveService? service;

  @override
  State<ArchiveCreateScreen> createState() => _ArchiveCreateScreenState();
}

class _ArchiveCreateScreenState extends State<ArchiveCreateScreen> {
  static const List<String> _firstPersonTokens = [
    '제가', '저는', '내가', '제', '나는',
  ];

  late final ArchiveService _service;

  final _formKey = GlobalKey<FormState>();
  final _contentController = TextEditingController();
  final _photoUrlController = TextEditingController();

  ArchiveCategory? _category;
  String? _selectedDong;
  List<String> _availableDongs = const [];
  bool _loadingDongs = true;
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    _service = widget.service ?? ArchiveService();
    _contentController.addListener(() => setState(() {}));
    _loadDongs();
  }

  @override
  void dispose() {
    _contentController.dispose();
    _photoUrlController.dispose();
    super.dispose();
  }

  Future<void> _loadDongs() async {
    try {
      final dongs = await _service.getAvailableDongs();
      if (!mounted) return;
      setState(() {
        _availableDongs = dongs;
        _loadingDongs = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _loadingDongs = false);
    }
  }

  void _snack(String message) {
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

  String? _validateRequired(String? value) {
    if (value == null || value.trim().isEmpty) return '필수 입력 항목입니다.';
    return null;
  }

  bool get _hasFirstPerson =>
      _firstPersonTokens.any(_contentController.text.contains);

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    if (_selectedDong == null) {
      _snack('동네(지역)를 선택해 주세요.');
      return;
    }
    if (!_hasFirstPerson) {
      _snack('1인칭 표현(제가/저는/내가)으로 직접 경험을 적어 주세요.');
    }

    final photoUrl = _photoUrlController.text.trim();
    setState(() => _submitting = true);
    try {
      await _service.createArchiveItem(
        category: _category!,
        voiceTranscript: _contentController.text.trim(),
        dong: _selectedDong,
        photoUrls: photoUrl.isEmpty ? null : [photoUrl],
      );
      if (!mounted) return;
      _snack('동네 지식이 등록되었습니다.');
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _submitting = false);
      _snack('등록에 실패했습니다: $e');
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
                value: _category,
                decoration: const InputDecoration(labelText: '분류'),
                hint: const Text('분류를 선택하세요'),
                items: const [
                  DropdownMenuItem(
                    value: ArchiveCategory.place,
                    child: Text('가게/장소'),
                  ),
                  DropdownMenuItem(
                    value: ArchiveCategory.walk,
                    child: Text('산책길'),
                  ),
                  DropdownMenuItem(
                    value: ArchiveCategory.other,
                    child: Text('기타'),
                  ),
                ],
                validator: (v) => v == null ? '분류를 선택해 주세요.' : null,
                onChanged:
                    _submitting ? null : (v) => setState(() => _category = v),
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _contentController,
                decoration: const InputDecoration(
                  labelText: '경험담 (1인칭)',
                  hintText: '제가 직접 경험한 내용을 1인칭으로 적어 주세요.',
                ),
                minLines: 3,
                maxLines: 6,
                validator: _validateRequired,
              ),
              const Padding(
                padding: EdgeInsets.only(top: 4),
                child: Text(
                  '예: "제가 가보니...", "저는 이 길을 산책했는데..."',
                  style: TextStyle(fontSize: 12),
                ),
              ),
              if (_contentController.text.trim().isNotEmpty && !_hasFirstPerson)
                const Padding(
                  padding: EdgeInsets.only(top: 4),
                  child: Text(
                    '1인칭 경험담 표현(제가/저는/내가)을 권장합니다.',
                    style: TextStyle(fontSize: 12, color: Colors.orange),
                  ),
                ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _photoUrlController,
                decoration: const InputDecoration(
                  labelText: '사진 URL (선택)',
                  hintText: 'https://...',
                ),
              ),
              const SizedBox(height: 16),
              _loadingDongs
                  ? const Center(child: CircularProgressIndicator())
                  : DropdownButtonFormField<String>(
                      value: _selectedDong,
                      decoration: const InputDecoration(
                        labelText: '동네(지역) 선택',
                        hintText: '동네를 선택해 주세요',
                      ),
                      items: _availableDongs
                          .map(
                            (d) => DropdownMenuItem(value: d, child: Text(d)),
                          )
                          .toList(),
                      onChanged: _submitting
                          ? null
                          : (v) => setState(() => _selectedDong = v),
                      validator: (v) => v == null ? '동네를 선택해 주세요.' : null,
                    ),
              const Padding(
                padding: EdgeInsets.only(top: 4),
                child: Text(
                  '정확한 좌표 대신 동(행정동) 단위로 위치가 저장됩니다.',
                  style: TextStyle(fontSize: 12, color: Colors.grey),
                ),
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
                    : const Text('등록하기'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
