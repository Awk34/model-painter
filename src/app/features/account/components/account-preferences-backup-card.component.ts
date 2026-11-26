import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { UserStateService } from '../../../core/services/user-state.service';

@Component({
  selector: 'app-account-preferences-backup-card',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './account-preferences-backup-card.component.ng.html',
  styleUrl: './account-card.shared.css',
})
export class AccountPreferencesBackupCardComponent {
  readonly userState = inject(UserStateService);

  readonly prefsForm = new FormGroup({
    allowCompatibleSubstitutions: new FormControl(true, { nonNullable: true }),
    allowThirdPartySubstitutions: new FormControl(true, { nonNullable: true }),
  });

  constructor() {
    effect(() => {
      const prefs = this.userState.preferences();
      if (
        this.prefsForm.controls.allowCompatibleSubstitutions.value !==
          prefs.allowCompatibleSubstitutions ||
        this.prefsForm.controls.allowThirdPartySubstitutions.value !==
          prefs.allowThirdPartySubstitutions
      ) {
        this.prefsForm.setValue(
          {
            allowCompatibleSubstitutions: prefs.allowCompatibleSubstitutions,
            allowThirdPartySubstitutions: prefs.allowThirdPartySubstitutions,
          },
          { emitEvent: false }
        );
      }
    });

    this.prefsForm.controls.allowCompatibleSubstitutions.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((allowCompatibleSubstitutions) => {
        this.userState.updatePreferences({ allowCompatibleSubstitutions });
      });

    this.prefsForm.controls.allowThirdPartySubstitutions.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((allowThirdPartySubstitutions) => {
        this.userState.updatePreferences({ allowThirdPartySubstitutions });
      });
  }

  confirmResetData(): void {
    if (confirm('Reset all local browser Inventory, Wishlist, and Projects to a blank slate?')) {
      this.userState.resetLocalData();
    }
  }
}
