import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';

/// 앱 내 사용자 역할.
enum UserRole {
  /// 동네 지식 등록·동행 요청 수락.
  guide,

  /// 안내자 검색·동행 요청 전송.
  traveler,

  /// 안내자 신청 승인·콘텐츠 관리.
  admin,
}

/// 인증 상태와 역할을 관리하는 싱글턴 서비스.
///
/// 에뮬레이터 방식(A): 역할 버튼 클릭 시 해당 테스트 계정으로 자동 로그인.
/// 나중에 B(이메일/비밀번호 입력)로 전환할 때는 [signIn] 내부만 교체하면 된다.
class AuthService extends ChangeNotifier {
  AuthService._();
  static final AuthService instance = AuthService._();

  UserRole? _role;

  /// 현재 로그인된 역할. 로그아웃 상태이면 null.
  UserRole? get role => _role;

  /// 로그인 여부.
  bool get isSignedIn => _role != null;

  /// 역할에 맞는 테스트 계정으로 로그인한다.
  ///
  /// [role]에 따라 에뮬레이터 시드 계정으로 signInWithEmailAndPassword를 호출하고,
  /// 성공 시 [role]을 저장해 리스너에 알린다.
  Future<void> signIn(UserRole role) async {
    final credentials = _credentialsFor(role);
    await FirebaseAuth.instance.signInWithEmailAndPassword(
      email: credentials.$1,
      password: credentials.$2,
    );
    _role = role;
    notifyListeners();
  }

  /// 로그아웃한다.
  Future<void> signOut() async {
    await FirebaseAuth.instance.signOut();
    _role = null;
    notifyListeners();
  }

  /// 역할별 에뮬레이터 테스트 계정 자격증명 (email, password).
  ///
  /// B 방식으로 전환 시 이 함수 대신 사용자 입력을 받도록 [signIn]을 수정한다.
  (String, String) _credentialsFor(UserRole role) {
    switch (role) {
      case UserRole.guide:
        return ('guide@eumgil.test', 'password');
      case UserRole.traveler:
        return ('traveler@eumgil.test', 'password');
      case UserRole.admin:
        return ('admin@eumgil.test', 'password');
    }
  }
}
