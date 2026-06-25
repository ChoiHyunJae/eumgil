import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';

import 'firebase_options.dart';
import 'screens/admin_approval_screen.dart';
import 'screens/archive_list_screen.dart';
import 'screens/guide_status_view.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);

  runApp(const EumgilApp());
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
