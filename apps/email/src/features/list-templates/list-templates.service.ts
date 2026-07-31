export class ListTemplatesService {
  execute(): string[] {
    return [
      'account_verification',
      'password_reset',
      'general_notification',
    ];
  }
}
