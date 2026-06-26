import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';

import 'firebase_options.dart';
import 'screens/admin_approval_screen.dart';
import 'screens/archive_list_screen.dart';
import 'screens/guide_search_screen.dart';
import 'screens/guide_status_view.dart';

/// 로컬 Firebase Emulator 사용 여부. 컴파일 타임 환경변수로만 켜진다
/// (`--dart-define=USE_EMULATOR=true`). 기본값 false이므로 실제 배포/일반
/// 실행에서는 emulator 연결·익명 로그인이 절대 수행되지 않는다.
const bool _useEmulator = bool.fromEnvironment(
  'USE_EMULATOR',
  defaultValue: false,
);

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);

  if (_useEmulator) {
    await _connectToEmulators();
  }

  runApp(const EumgilApp());
}

/// 로컬 emulator(Functions/Auth)에 연결하고, 익명 로그인으로 인증을 채운다.
/// USE_EMULATOR=true일 때만 호출된다.
Future<void> _connectToEmulators() async {
  FirebaseFunctions.instance.useFunctionsEmulator('localhost', 5001);
  await FirebaseAuth.instance.useAuthEmulator('localhost', 9099);
  if (FirebaseAuth.instance.currentUser == null) {
    await FirebaseAuth.instance.signInAnonymously();
  }
}

/// Slice 0(Issue #2) 스캐폴딩: 빈 홈 화면만 존재하는 앱 골격.
/// 실제 화면/기능은 이후 슬라이스에서 callable function과 함께 채워진다.
class EumgilApp extends StatelessWidget {
  const EumgilApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '이음길',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.teal),
      ),
      home: const HomeScreen(),
    );
  }
}

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('이음길'),
        actions: [
          IconButton(
            icon: const Icon(Icons.person_search),
            tooltip: '주변 안내자 찾기',
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => const GuideSearchScreen(),
              ),
            ),
          ),
          IconButton(
            icon: const Icon(Icons.travel_explore),
            tooltip: '주변 동네 지식',
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => const ArchiveListScreen(),
              ),
            ),
          ),
          IconButton(
            icon: const Icon(Icons.admin_panel_settings),
            tooltip: '운영자: 안내자 신청 승인',
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => const AdminApprovalScreen(),
              ),
            ),
          ),
        ],
      ),
      body: const GuideStatusView(),
    );
  }
}
