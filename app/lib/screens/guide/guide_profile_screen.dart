import 'package:flutter/material.dart';

import '../../services/profile_service.dart';

/// 안내자가 소개말·사진 URL을 작성/수정하는 화면.
class GuideProfileScreen extends StatefulWidget {
  const GuideProfileScreen({
    super.key,
    this.initialBio,
    this.initialPhotoUrl,
    this.service,
  });

  final String? initialBio;
  final String? initialPhotoUrl;
  final ProfileService? service;

  @override
  State<GuideProfileScreen> createState() => _GuideProfileScreenState();
}

class _GuideProfileScreenState extends State<GuideProfileScreen> {
  late final ProfileService _service;
  late final TextEditingController _bioController;
  late final TextEditingController _photoUrlController;

  bool _saving = false;
  int get _bioLength => _bioController.text.length;

  @override
  void initState() {
    super.initState();
    _service = widget.service ?? ProfileService();
    _bioController = TextEditingController(text: widget.initialBio ?? '');
    _photoUrlController =
        TextEditingController(text: widget.initialPhotoUrl ?? '');
    _bioController.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _bioController.dispose();
    _photoUrlController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final bio = _bioController.text.trim();
    if (bio.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('소개말을 입력해 주세요.')),
      );
      return;
    }
    if (bio.length > 300) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('소개말은 300자 이하여야 합니다.')),
      );
      return;
    }
    setState(() => _saving = true);
    try {
      final photoUrl = _photoUrlController.text.trim();
      await _service.updateProfile(
        bio: bio,
        photoUrl: photoUrl.isNotEmpty ? photoUrl : null,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('프로필이 저장되었습니다.'),
          backgroundColor: const Color(0xFF1B8A6B),
          behavior: SnackBarBehavior.floating,
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
      );
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('저장에 실패했습니다: $e'),
          backgroundColor: Colors.red.shade700,
        ),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FA),
      appBar: AppBar(
        title: const Text('프로필 편집',
            style: TextStyle(fontWeight: FontWeight.w700)),
        backgroundColor: const Color(0xFF1B8A6B),
        foregroundColor: Colors.white,
        elevation: 0,
        actions: [
          TextButton(
            onPressed: _saving ? null : _save,
            child: _saving
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                        strokeWidth: 2, color: Colors.white),
                  )
                : const Text('저장',
                    style: TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w700,
                        fontSize: 15)),
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildLabel('프로필 사진 URL (선택)'),
            const SizedBox(height: 8),
            TextField(
              controller: _photoUrlController,
              decoration: _inputDecoration(
                hint: 'https://...',
                prefix: const Icon(Icons.image_outlined,
                    color: Color(0xFF1B8A6B)),
              ),
            ),
            const SizedBox(height: 24),
            _buildLabel('소개말'),
            const SizedBox(height: 8),
            TextField(
              controller: _bioController,
              maxLines: 6,
              maxLength: 300,
              decoration: _inputDecoration(
                hint: '탐방자에게 본인을 소개해 주세요.\n'
                    '예) 서울 종로 20년 거주자입니다. '
                    '골목 구석구석 숨겨진 이야기를 들려드릴게요!',
                counterText: '',
              ),
            ),
            Align(
              alignment: Alignment.centerRight,
              child: Text(
                '$_bioLength / 300',
                style: TextStyle(
                  fontSize: 12,
                  color: _bioLength > 300
                      ? Colors.red
                      : Colors.grey.shade500,
                ),
              ),
            ),
            const SizedBox(height: 32),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: _saving ? null : _save,
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF1B8A6B),
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14)),
                ),
                child: _saving
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white),
                      )
                    : const Text('저장하기',
                        style: TextStyle(
                            fontSize: 16, fontWeight: FontWeight.w700)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildLabel(String text) {
    return Text(text,
        style: const TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w600,
            color: Color(0xFF1B2D1F)));
  }

  InputDecoration _inputDecoration({
    required String hint,
    Widget? prefix,
    String? counterText,
  }) {
    return InputDecoration(
      hintText: hint,
      hintStyle: TextStyle(
          color: Colors.grey.shade400, fontSize: 13, height: 1.6),
      prefixIcon: prefix,
      counterText: counterText,
      filled: true,
      fillColor: Colors.white,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: Colors.grey.shade200),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: Colors.grey.shade200),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide:
            const BorderSide(color: Color(0xFF1B8A6B), width: 2),
      ),
      contentPadding: const EdgeInsets.all(16),
    );
  }
}
