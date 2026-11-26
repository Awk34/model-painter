import { ChangeDetectionStrategy, Component, effect, inject, input, model, output, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { WarhammerImportService } from '../../../core/services/warhammer-import.service';

@Component({
  selector: 'app-warhammer-importer-card',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './warhammer-importer-card.component.ng.html',
  styleUrl: './account-card.shared.css',
})
export class WarhammerImporterCardComponent {
  readonly importer = inject(WarhammerImportService);

  readonly importMode = model<'merge' | 'replace'>('merge');
  readonly snapshotAvailable = input<boolean | null>(null);
  readonly snapshotBusy = input<boolean>(false);
  readonly snapshotError = input<string | null>(null);
  readonly loadSnapshot = output<void>();

  readonly importModeControl = new FormControl<'merge' | 'replace'>('merge', { nonNullable: true });
  readonly callbackUrlControl = new FormControl('', { nonNullable: true });
  readonly pkceForm = new FormGroup({ callbackUrl: this.callbackUrlControl });
  readonly callbackUrlValue = toSignal(this.callbackUrlControl.valueChanges, { initialValue: '' });

  readonly pkceBusy = signal(false);
  readonly pkceError = signal<string | null>(null);
  readonly pkceUrlCopied = signal(false);

  constructor() {
    effect(() => {
      const mode = this.importMode();
      if (this.importModeControl.value !== mode) {
        this.importModeControl.setValue(mode, { emitEvent: false });
      }
    });

    this.importModeControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((mode) => {
      this.importMode.set(mode);
    });
  }

  async startPkceLogin(): Promise<void> {
    this.pkceError.set(null);
    try {
      const { authorizeUrl } = await this.importer.generateMyWarhammerLoginUrl();
      window.open(authorizeUrl, '_blank', 'noopener');
    } catch (e: unknown) {
      this.pkceError.set(e instanceof Error ? e.message : String(e));
    }
  }

  async copyPkceLoginUrl(): Promise<void> {
    this.pkceError.set(null);
    try {
      const { authorizeUrl } = await this.importer.generateMyWarhammerLoginUrl();
      await navigator.clipboard.writeText(authorizeUrl);
      this.pkceUrlCopied.set(true);
      setTimeout(() => this.pkceUrlCopied.set(false), 2500);
    } catch (e: unknown) {
      this.pkceError.set(e instanceof Error ? e.message : String(e));
    }
  }

  async submitPkceCallback(): Promise<void> {
    this.pkceBusy.set(true);
    this.pkceError.set(null);
    try {
      await this.importer.exchangeCallbackAndImport(
        this.callbackUrlControl.value,
        this.importMode()
      );
      this.callbackUrlControl.setValue('');
    } catch (e: unknown) {
      this.pkceError.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.pkceBusy.set(false);
    }
  }

  async onFileUpload(event: Event): Promise<void> {
    const inputEl = event.target as HTMLInputElement;
    const file = inputEl.files?.[0];
    if (!file) {
      return;
    }
    try {
      await this.importer.importFromFile(file, this.importMode());
    } catch (e: unknown) {
      this.pkceError.set(e instanceof Error ? e.message : String(e));
    } finally {
      inputEl.value = '';
    }
  }
}
