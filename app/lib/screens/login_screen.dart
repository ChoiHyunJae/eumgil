import 'package:flutter/material.dart';

import '../auth/auth_service.dart';

/// 역할 선택 로그인 화면.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  UserRole? _signingIn;

  Future<void> _signIn(UserRole role) async {
    if (_signingIn != null) return;
    setState(() => _signingIn = role);
    try {
      await AuthService.instance.signIn(role);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('로그인 실패. 에뮬레이터가 실행 중인지 확인하세요.\n$e'),
          backgroundColor: Colors.red.shade700,
        ),
      );
    } finally {
      if (mounted) setState(() => _signingIn = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [Color(0xFFE8F5E9), Color(0xFFF8F9FA)],
          ),
        ),
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding:
                  const EdgeInsets.symmetric(horizontal: 28, vertical: 24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  _buildHeader(),
                  const SizedBox(height: 48),
                  _buildRoleCard(
                    role: UserRole.guide,
                    icon: Icons.directions_walk_rounded,
                    title: '안내자',
                    description: '동네 지식을 나누고\n탐방자와 함께 걸어요',
                    color: const Color(0xFF1B8A6B),
                  ),
                  const SizedBox(height: 16),
                  _buildRoleCard(
                    role: UserRole.traveler,
                    icon: Icons.explore_rounded,
                    title: '탐방자',
                    description: '동네 안내자와 함께\n새로운 길을 걸어요',
                    color: const Color(0xFF2979FF),
                  ),
                  const SizedBox(height: 32),
                  _buildAdminButton(),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Column(
      children: [
        Container(
          width: 80,
          height: 80,
          decoration: BoxDecoration(
            color: const Color(0xFF1B8A6B),
            borderRadius: BorderRadius.circular(24),
            boxShadow: [
              BoxShadow(
                color: const Color(0xFF1B8A6B).withValues(alpha: 0.3),
                blurRadius: 20,
                offset: const Offset(0, 8),
              ),
            ],
          ),
          child: const Icon(Icons.park_rounded, color: Colors.white, size: 44),
        ),
        const SizedBox(height: 20),
        const Text(
          '이음길',
          style: TextStyle(
            fontSize: 36,
            fontWeight: FontWeight.w800,
            color: Color(0xFF1B2D1F),
            letterSpacing: -0.5,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          '동네를 잇는 이야기',
          style: TextStyle(
            fontSize: 16,
            color: Colors.grey.shade600,
            letterSpacing: 0.3,
          ),
        ),
      ],
    );
  }

  Widget _buildRoleCard({
    required UserRole role,
    required IconData icon,
    required String title,
    required String description,
    required Color color,
  }) {
    final isLoading = _signingIn == role;
    final isDisabled = _signingIn != null && !isLoading;

    return AnimatedOpacity(
      opacity: isDisabled ? 0.5 : 1.0,
      duration: const Duration(milliseconds: 200),
      child: GestureDetector(
        onTap: isDisabled ? null : () => _signIn(role),
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(20),
            boxShadow: [
              BoxShadow(
                color: color.withValues(alpha: 0.12),
                blurRadius: 20,
                offset: const Offset(0, 8),
              ),
            ],
            border: Border.all(color: color.withValues(alpha: 0.15)),
          ),
          child: Row(
            children: [
              Container(
                width: 56,
                height: 56,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Icon(icon, color: color, size: 28),
              ),
              const SizedBox(width: 20),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w700,
                        color: Color(0xFF1B2D1F),
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      description,
                      style: TextStyle(
                        fontSize: 13,
                        color: Colors.grey.shade600,
                        height: 1.5,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              isLoading
                  ? SizedBox(
                      width: 24,
                      height: 24,
                      child: CircularProgressIndicator(
                        strokeWidth: 2.5,
                        color: color,
                      ),
                    )
                  : Container(
                      width: 36,
                      height: 36,
                      decoration: BoxDecoration(
                        color: color,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: const Icon(
                        Icons.arrow_forward_ios_rounded,
                        color: Colors.white,
                        size: 16,
                      ),
                    ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildAdminButton() {
    final isLoading = _signingIn == UserRole.admin;
    return TextButton.icon(
      onPressed: _signingIn != null ? null : () => _signIn(UserRole.admin),
      icon: isLoading
          ? SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: Colors.grey.shade500,
              ),
            )
          : Icon(
              Icons.admin_panel_settings_outlined,
              size: 16,
              color: Colors.grey.shade500,
            ),
      label: Text(
        '관리자로 로그인',
        style: TextStyle(color: Colors.grey.shade500, fontSize: 13),
      ),
    );
  }
}
