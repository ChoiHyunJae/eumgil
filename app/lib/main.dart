import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';

import 'auth/auth_service.dart';
import 'firebase_options.dart';
import 'screens/admin/admin_home_screen.dart';
import 'screens/guide/guide_home_screen.dart';
import 'screens/login_screen.dart';
import 'screens/traveler/traveler_home_screen.dart';

/// 로컬 Firebase Emulator 사용 여부.
/// `--dart-define=USE_EMULATOR=true`일 때만 활성화된다.
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

/// 에뮬레이터(Functions/Auth)에 연결한다.
/// 익명 로그인은 하지 않는다 — 로그인 화면에서 역할을 선택해 로그인한다.
Future<void> _connectToEmulators() async {
  FirebaseFunctions.instance.useFunctionsEmulator('localhost', 5001);
  await FirebaseAuth.instance.useAuthEmulator('localhost', 9099);
}

class EumgilApp extends StatelessWidget {
  const EumgilApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '이음길',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorSchemeSeed: const Color(0xFF1B8A6B),
        scaffoldBackgroundColor: const Color(0xFFF5F7FA),
        appBarTheme: const AppBarTheme(elevation: 0, scrolledUnderElevation: 0),
        cardTheme: CardThemeData(
          elevation: 0,
          color: Colors.white,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
        ),
        inputDecorationTheme: InputDecorationTheme(
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
            borderSide: const BorderSide(color: Color(0xFF1B8A6B), width: 2),
          ),
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        ),
        elevatedButtonTheme: ElevatedButtonThemeData(
          style: ElevatedButton.styleFrom(
            backgroundColor: const Color(0xFF1B8A6B),
            foregroundColor: Colors.white,
            elevation: 0,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
            ),
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
            textStyle: const TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
      ),
      home: const _AppEntry(),
    );
  }
}

/// 인증 상태에 따라 로그인 화면 또는 역할별 홈 화면으로 라우팅한다.
class _AppEntry extends StatelessWidget {
  const _AppEntry();

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: AuthService.instance,
      builder: (context, _) {
        if (!AuthService.instance.isSignedIn) {
          return const LoginScreen();
        }
        switch (AuthService.instance.role!) {
          case UserRole.guide:
            return const GuideHomeScreen();
          case UserRole.traveler:
            return const TravelerHomeScreen();
          case UserRole.admin:
            return const AdminHomeScreen();
        }
      },
    );
  }
}
