import { ChangeDetectionStrategy, Component, effect, input, model, output } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ThirdPartyPaint } from '../../../core/models/catalog.models';

@Component({
  selector: 'app-paint-override-linker',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './paint-override-linker.component.ng.html',
  styleUrl: './paint-override-linker.component.css',
})
export class PaintOverrideLinkerComponent {
  readonly paints = input.required<ThirdPartyPaint[]>();
  readonly selectedPaintId = model<string>('');
  readonly linkRequested = output<string>();

  readonly overrideControl = new FormControl('', { nonNullable: true });

  constructor() {
    effect(() => {
      const value = this.selectedPaintId();
      if (this.overrideControl.value !== value) {
        this.overrideControl.setValue(value, { emitEvent: false });
      }
    });

    this.overrideControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((val) => {
      this.selectedPaintId.set(val);
    });
  }

  onLinkClick(): void {
    const id = this.selectedPaintId();
    if (!id) {
      return;
    }
    this.linkRequested.emit(id);
  }
}
