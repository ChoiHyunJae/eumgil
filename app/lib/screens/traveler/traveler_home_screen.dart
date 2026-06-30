import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../../auth/auth_service.dart';
import '../guide_search_screen.dart';
import '../my_escort_screen.dart';

/// 탐방자 전용 홈 화면.
class TravelerHomeScreen extends StatefulWidget {
  const TravelerHomeScreen({super.key});

  @override
  State<TravelerHomeScreen> createState() => _TravelerHomeScreenState();
}

class _TravelerHomeScreenState extends State<TravelerHomeScreen> {
  int _tabIndex = 0;

  String? get _uid => FirebaseAuth.instance.currentUser?.uid;

  Future<void> _signOut() async {
    await AuthService.instance.signOut();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FA),
      appBar: AppBar(
        backgroundColor: const Color(0xFF2979FF),
        foregroundColor: Colors.white,
        elevation: 0,
        title: const Text(
          '이음길',
          style: TextStyle(fontWeight: FontWeight.w800, fontSize: 22),
        ),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 4),
            child: Chip(
              label: const Text('탐방자', style: TextStyle(fontSize: 12)),
              backgroundColor: Colors.white24,
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
      ),
      body: IndexedStack(
        index: _tabIndex,
        children: [
          const GuideSearchScreen(),
          MyEscortScreen(currentUserId: _uid),
        ],
      ),
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _tabIndex,
        onTap: (i) => setState(() => _tabIndex = i),
        selectedItemColor: const Color(0xFF2979FF),
        unselectedItemColor: Colors.grey,
        backgroundColor: Colors.white,
        elevation: 16,
        items: const [
          BottomNavigationBarItem(
            icon: Icon(Icons.search_outlined),
            activeIcon: Icon(Icons.search),
            label: '안내자 찾기',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.directions_walk_outlined),
            activeIcon: Icon(Icons.directions_walk),
            label: '내 동행',
          ),
        ],
      ),
    );
  }
}
