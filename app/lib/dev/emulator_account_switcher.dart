import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

/// 로컬 Emulator 전용 테스트 계정 전환 바.
///
/// USE_EMULATOR=true일 때만 렌더링되도록 호출부(main.dart)에서 컴파일 타임 const로
/// 가드한다. 일반/배포 빌드에서는 이 위젯이 참조되지 않아 트리쉐이킹으로 제거된다.
///
/// seed:emulator로 생성한 계정으로 signInWithEmailAndPassword 전환하며, 로그인 후
/// ID 토큰을 강제 새로고침해 custom claim(admin 등)이 즉시 반영되게 한다.
class EmulatorAccountSwitcher extends StatefulWidget {
  const EmulatorAccountSwitcher({super.key});

  @override
  State<EmulatorAccountSwitcher> createState() =>
      _EmulatorAccountSwitcherState();
}

/// seed:emulator가 만든 테스트 계정 정의(라벨, 이메일).
class _TestAccount {
  const _TestAccount(this.label, this.email);

  final String label;
  final String email;
}

class _EmulatorAccountSwitcherState extends State<EmulatorAccountSwitcher> {
  static const String _password = 'password';
  static const List<_TestAccount> _accounts = [
    _TestAccount('admin', 'admin@eumgil.test'),
    _TestAccount('traveler', 'traveler@eumgil.test'),
    _TestAccount('guide', 'guide@eumgil.test'),
  ];

  bool _busy = false;

  Future<void> _signIn(_TestAccount account) async {
    setState(() => _busy = true);
    try {
      await FirebaseAuth.instance.signInWithEmailAndPassword(
        email: account.email,
        password: _password,
      );
      // 토큰을 강제 새로고침해 custom claim(admin 등)을 즉시 반영한다.
      await FirebaseAuth.instance.currentUser?.getIdToken(true);
      if (!mounted) return;
      _snack('로그인: ${account.label} (${account.email})');
    } catch (e) {
      if (!mounted) return;
      _snack('로그인 실패: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _signInAnonymously() async {
    setState(() => _busy = true);
    try {
      await FirebaseAuth.instance.signInAnonymously();
      // 익명 계정으로 돌아가면 claim이 사라지므로 토큰을 새로고침한다.
      await FirebaseAuth.instance.currentUser?.getIdToken(true);
      if (!mounted) return;
      _snack('로그인: 익명');
    } catch (e) {
      if (!mounted) return;
      _snack('로그인 실패: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _snack(String message) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  String _currentLabel() {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return '미로그인';
    if (user.isAnonymous) return '익명 (${user.uid})';
    return user.email ?? user.uid;
  }

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.amber.shade100,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '[Emulator] 현재 계정: ${_currentLabel()}',
              style: const TextStyle(fontSize: 12),
            ),
            const SizedBox(height: 4),
            Wrap(
              spacing: 8,
              children: [
                for (final account in _accounts)
                  ElevatedButton(
                    onPressed: _busy ? null : () => _signIn(account),
                    child: Text(account.label),
                  ),
                OutlinedButton(
                  onPressed: _busy ? null : _signInAnonymously,
                  child: const Text('익명'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
