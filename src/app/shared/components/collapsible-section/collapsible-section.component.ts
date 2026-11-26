import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

@Component({
  selector: 'app-collapsible-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './collapsible-section.component.ng.html',
  styleUrl: './collapsible-section.component.css',
})
export class CollapsibleSectionComponent {
  readonly title = input.required<string>();
  readonly expanded = model<boolean>(true);
  readonly contentClass = input<string>('');

  toggle(): void {
    this.expanded.update((v) => !v);
  }
}
