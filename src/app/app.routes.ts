import { Routes } from '@angular/router';
import { HobbyDeskComponent } from './features/hobby-desk/hobby-desk.component';
import { ProjectDetailComponent } from './features/hobby-desk/project-detail.component';
import { PaintModelComponent } from './features/paint-model/paint-model.component';
import { ModelDetailComponent } from './features/paint-model/model-detail.component';
import { PaintColourComponent } from './features/paint-colour/paint-colour.component';
import { ColourDetailComponent } from './features/paint-colour/colour-detail.component';
import { SearchComponent } from './features/search/search.component';

export const routes: Routes = [
  { path: '', redirectTo: 'hobby-desk', pathMatch: 'full' },
  { path: 'hobby-desk', component: HobbyDeskComponent },
  { path: 'account', component: HobbyDeskComponent, data: { page: 'account' } },
  { path: 'projects/:id', component: ProjectDetailComponent },
  { path: 'models', component: PaintModelComponent },
  { path: 'models/:id', component: ModelDetailComponent },
  { path: 'colours', component: PaintColourComponent },
  { path: 'colours/:id', component: ColourDetailComponent },
  { path: 'search', component: SearchComponent },
  { path: '**', redirectTo: 'hobby-desk' },
];
