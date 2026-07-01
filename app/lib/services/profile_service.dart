import 'package:cloud_functions/cloud_functions.dart';

/// 프로필 업데이트 Cloud Functions callable을 감싸는 service.
class ProfileService {
  ProfileService([this._functions]);

  final FirebaseFunctions? _functions;
  FirebaseFunctions get _fn => _functions ?? FirebaseFunctions.instance;

  /// 소개말·사진 URL을 업데이트한다.
  Future<void> updateProfile({String? bio, String? photoUrl}) async {
    final payload = <String, dynamic>{};
    if (bio != null) payload['bio'] = bio;
    if (photoUrl != null) payload['photoUrl'] = photoUrl;
    await _fn.httpsCallable('updateUserProfile').call(payload);
  }
}
