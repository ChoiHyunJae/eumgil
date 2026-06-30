import 'package:flutter/material.dart';

import '../../auth/auth_service.dart';
import '../admin_approval_screen.dart';
import '../approved_guides_screen.dart';
import '../archive_hide_screen.dart';

/// 관리자 전용 홈 화면.
///
/// BottomNavigationBar로 세 탭을 관리한다:
/// - 탭 0: 안내자 신청 승인
/// - 탭 1: 안내자 관리 (승인된 안내자 목록 + 자격 상실 처리)
/// - 탭 2: 동네 지식 관리 (숨김 처리)
class AdminHomeScreen extends StatefulWidget {
  const AdminHomeScreen({super.key});

  @override
  State<AdminHomeScreen> createState() => _AdminHomeScreenState();
}

class _AdminHomeScreenState extends State<AdminHomeScreen> {
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
        children: const [
          AdminApprovalScreen(),
          ApprovedGuidesScreen(),
          ArchiveHideScreen(),
        ],
      ),
      bottomNavigationBar: _buildBottomNav(),
    );
  }

  PreferredSizeWidget _buildAppBar() {
    return AppBar(
      backgroundColor: const Color(0xFF37474F),
      foregroundColor: Colors.white,
      elevation: 0,
      title: const Text(
        '이음길 관리자',
        style: TextStyle(
          fontWeight: FontWeight.w800,
          fontSize: 20,
          letterSpacing: -0.3,
        ),
      ),
      actions: [
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
      selectedItemColor: const Color(0xFF37474F),
      unselectedItemColor: Colors.grey.shade500,
      backgroundColor: Colors.white,
      elevation: 16,
      items: const [
        BottomNavigationBarItem(
          icon: Icon(Icons.how_to_reg_outlined),
          activeIcon: Icon(Icons.how_to_reg),
          label: '신청 승인',
        ),
        BottomNavigationBarItem(
          icon: Icon(Icons.people_outline),
          activeIcon: Icon(Icons.people),
          label: '안내자 관리',
        ),
        BottomNavigationBarItem(
          icon: Icon(Icons.visibility_off_outlined),
          activeIcon: Icon(Icons.visibility_off),
          label: '콘텐츠 관리',
        ),
      ],
    );
  }
}
