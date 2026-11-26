import { ChangeDetectionStrategy, Component, effect, inject, model } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { UserStateService } from '../../../core/services/user-state.service';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';

@Component({
  selector: 'app-cloud-auth-sync-card',
  imports: [ReactiveFormsModule, AppIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './cloud-auth-sync-card.component.ng.html',
  styleUrl: './account-card.shared.css',
})
export class CloudAuthSyncCardComponent {
  readonly userState = inject(UserStateService);

  readonly authError = model<string | null>(null);
  readonly avatarFailed = model<boolean>(false);

  readonly authForm = new FormGroup({
    email: new FormControl('', { nonNullable: true }),
    password: new FormControl('', { nonNullable: true }),
  });

  constructor() {
    effect(() => {
      this.userState.currentUser()?.photoURL;
      this.avatarFailed.set(false);
    });
  }

  onAvatarError(): void {
    this.avatarFailed.set(true);
  }

  async handleEmailAuth(isSignUp: boolean): Promise<void> {
    this.authError.set(null);
    const { email, password } = this.authForm.getRawValue();
    try {
      await this.userState.signInWithEmail(email, password, isSignUp);
    } catch (e: unknown) {
      this.authError.set(e instanceof Error ? e.message : String(e));
    }
  }

  async handleGoogleAuth(): Promise<void> {
    this.authError.set(null);
    try {
      await this.userState.signInWithGoogle();
    } catch (e: unknown) {
      this.authError.set(e instanceof Error ? e.message : String(e));
    }
  }
}
