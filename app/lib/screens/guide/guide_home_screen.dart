import 'package:flutter/material.dart';

import '../../auth/auth_service.dart';
import '../archive_create_screen.dart';
import '../archive_list_screen.dart';
import '../received_escort_requests_screen.dart';

/// 안내자 전용 홈 화면.
///
/// BottomNavigationBar로 두 탭을 관리한다:
/// - 탭 0: 동네 지식 (목록 + 등록 FAB)
/// - 탭 1: 받은 동행 요청
class GuideHomeScreen extends StatefulWidget {
  const GuideHomeScreen({super.key});

  @override
  State<GuideHomeScreen> createState() => _GuideHomeScreenState();
}

class _GuideHomeScreenState extends State<GuideHomeScreen> {
  int _tabIndex = 0;

  Future<void> _signOut() async {
    await AuthService.instance.signOut();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FA),
      appBar: _buildAppBar(),
      body: IndexedStack(
        index: _tabIndex,
        children: [
          _GuideArchiveTab(onCreatePressed: _openCreate),
          const ReceivedEscortRequestsScreen(),
        ],
      ),
      bottomNavigationBar: _buildBottomNav(),
    );
  }

  PreferredSizeWidget _buildAppBar() {
    return AppBar(
      backgroundColor: const Color(0xFF1B8A6B),
      foregroundColor: Colors.white,
      elevation: 0,
      title: const Text(
        '이음길',
        style: TextStyle(
          fontWeight: FontWeight.w800,
          fontSize: 22,
          letterSpacing: -0.3,
        ),
      ),
      actions: [
        Padding(
          padding: const EdgeInsets.only(right: 4),
          child: Chip(
            label: const Text('안내자', style: TextStyle(fontSize: 12)),
            backgroundColor: Colors.white.withValues(alpha: 0.25),
            labelStyle: const TextStyle(color: Colors.white),
            side: BorderSide.none,
          ),
        ),
        IconButton(
          icon: const Icon(Icons.logout_rounded),
          tooltip: '로그아웃',
          onPressed: _signOut,
        ),
      ],
    );
  }

  Widget _buildBottomNav() {
    return BottomNavigationBar(
      currentIndex: _tabIndex,
      onTap: (i) => setState(() => _tabIndex = i),
      selectedItemColor: const Color(0xFF1B8A6B),
      unselectedItemColor: Colors.grey.shade500,
      backgroundColor: Colors.white,
      elevation: 16,
      items: const [
        BottomNavigationBarItem(
          icon: Icon(Icons.auto_stories_outlined),
          activeIcon: Icon(Icons.auto_stories),
          label: '동네 지식',
        ),
        BottomNavigationBarItem(
          icon: Icon(Icons.inbox_outlined),
          activeIcon: Icon(Icons.inbox),
          label: '받은 요청',
        ),
      ],
    );
  }

  Future<void> _openCreate() async {
    final created = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => const ArchiveCreateScreen()),
    );
    if (created == true) {
      setState(() {}); // 목록 새로고침 트리거
    }
  }
}

/// 동네 지식 탭 — ArchiveListScreen을 래핑하고 등록 FAB을 추가한다.
class _GuideArchiveTab extends StatelessWidget {
  const _GuideArchiveTab({required this.onCreatePressed});

  final VoidCallback onCreatePressed;

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        const ArchiveListScreen(),
        Positioned(
          right: 16,
          bottom: 16,
          child: FloatingActionButton.extended(
            onPressed: onCreatePressed,
            backgroundColor: const Color(0xFF1B8A6B),
            foregroundColor: Colors.white,
            icon: const Icon(Icons.add),
            label: const Text('동네 지식 등록'),
          ),
        ),
      ],
    );
  }
}
