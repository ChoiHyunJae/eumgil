import 'package:flutter/material.dart';

import '../services/archive_service.dart';

/// 승인된 안내자가 동네 지식을 등록하는 입력 폼 화면.
///
/// 카테고리 선택(필수), 1인칭 경험담 내용(필수), 위치 확인(필수), 사진 URL(선택)을
/// 받아 createArchiveItem을 호출한다. 실제 음성 녹음/Storage 업로드/지도·GPS 연동은
/// 없고 MVP/Emulator 기준으로 수동 입력·데모 좌표를 사용한다.
class ArchiveCreateScreen extends StatefulWidget {
  const ArchiveCreateScreen({super.key, this.service});

  /// 테스트에서 가짜 구현을 주입하기 위한 선택적 의존성. null이면 기본 생성.
  final ArchiveService? service;

  @override
  State<ArchiveCreateScreen> createState() => _ArchiveCreateScreenState();
}

class _ArchiveCreateScreenState extends State<ArchiveCreateScreen> {
  /// 데모 위치(서울 종로/광화문 인근). 실제 GPS 대신 사용한다.
  static const double _demoLat = 37.57295;
  static const double _demoLng = 126.97936;

  /// 1인칭 표현 후보(있으면 경험담으로 간주). 없으면 안내만 하고 막지는 않는다.
  static const List<String> _firstPersonTokens = [
    '제가',
    '저는',
    '내가',
    '제',
    '나는',
  ];

  late final ArchiveService _service;

  final _formKey = GlobalKey<FormState>();
  final _contentController = TextEditingController();
  final _latController = TextEditingController();
  final _lngController = TextEditingController();
  final _photoUrlController = TextEditingController();

  ArchiveCategory? _category;
  bool _locationConfirmed = false;
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    _service = widget.service ?? ArchiveService();
    // 좌표가 바뀌면 위치 확인 상태를 무효화한다.
    _latController.addListener(_invalidateLocation);
    _lngController.addListener(_invalidateLocation);
    // 1인칭 안내 갱신을 위해 내용 변경을 구독한다.
    _contentController.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _contentController.dispose();
    _latController.dispose();
    _lngController.dispose();
    _photoUrlController.dispose();
    super.dispose();
  }

  void _invalidateLocation() {
    if (_locationConfirmed) {
      setState(() => _locationConfirmed = false);
    }
  }

  void _snack(String message) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
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

  bool get _hasFirstPerson {
    final text = _contentController.text;
    return _firstPersonTokens.any(text.contains);
  }

  void _useDemoLocation() {
    _latController.text = _demoLat.toString();
    _lngController.text = _demoLng.toString();
    // 좌표 변경 리스너가 _locationConfirmed를 false로 되돌린다.
    _snack('데모 위치를 입력했습니다. "이 위치로 등록할까요?"를 눌러 확인하세요.');
  }

  void _confirmLocation() {
    final lat = double.tryParse(_latController.text.trim());
    final lng = double.tryParse(_lngController.text.trim());
    if (lat == null || lng == null) {
      _snack('위도/경도를 숫자로 입력해 주세요.');
      return;
    }
    setState(() => _locationConfirmed = true);
    _snack('위치가 확인되었습니다.');
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return; // 분류·내용·좌표 검증
    if (!_locationConfirmed) {
      _snack('이 위치로 등록할지 확인해 주세요.');
      return;
    }
    if (!_hasFirstPerson) {
      // 막지는 않고 1인칭 경험담 작성을 권장하는 안내만 한다(서버 계약 불변).
      _snack('1인칭 표현(제가/저는/내가)으로 직접 경험을 적어 주세요.');
    }

    final photoUrl = _photoUrlController.text.trim();
    setState(() => _submitting = true);
    try {
      await _service.createArchiveItem(
        category: _category!,
        voiceTranscript: _contentController.text.trim(),
        lat: double.parse(_latController.text.trim()),
        lng: double.parse(_lngController.text.trim()),
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
                initialValue: _category,
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
                validator: (value) =>
                    value == null ? '분류를 선택해 주세요.' : null,
                onChanged: _submitting
                    ? null
                    : (value) => setState(() => _category = value),
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
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: _submitting ? null : _useDemoLocation,
                      child: const Text('데모 위치 사용'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: ElevatedButton(
                      onPressed: _submitting ? null : _confirmLocation,
                      child: const Text('이 위치로 등록할까요?'),
                    ),
                  ),
                ],
              ),
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  _locationConfirmed ? '위치 확인됨' : '위치 미확인',
                  style: TextStyle(
                    fontSize: 12,
                    color: _locationConfirmed ? Colors.green : Colors.grey,
                  ),
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
                    : const Text('등록'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
