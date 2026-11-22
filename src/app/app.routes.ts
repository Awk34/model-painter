import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: 'hobby-desk', pathMatch: 'full' },
  {
    path: 'hobby-desk',
    loadComponent: () =>
      import('./features/hobby-desk/hobby-desk.component').then((m) => m.HobbyDeskComponent),
  },
  {
    path: 'account',
    data: { page: 'account' },
    loadComponent: () =>
      import('./features/hobby-desk/hobby-desk.component').then((m) => m.HobbyDeskComponent),
  },
  {
    path: 'projects/:id',
    loadComponent: () =>
      import('./features/hobby-desk/project-detail.component').then(
        (m) => m.ProjectDetailComponent
      ),
  },
  {
    path: 'projects/:projectId/models/:entryId',
    loadComponent: () =>
      import('./features/paint-model/model-detail.component').then((m) => m.ModelDetailComponent),
  },
  {
    path: 'models',
    loadComponent: () =>
      import('./features/paint-model/paint-model.component').then((m) => m.PaintModelComponent),
  },
  {
    path: 'models/:id',
    loadComponent: () =>
      import('./features/paint-model/model-detail.component').then((m) => m.ModelDetailComponent),
  },
  {
    path: 'colors',
    loadComponent: () =>
      import('./features/paint-color/paint-color.component').then((m) => m.PaintColorComponent),
  },
  {
    path: 'colors/:id',
    loadComponent: () =>
      import('./features/paint-color/color-detail.component').then((m) => m.ColorDetailComponent),
  },
  {
    path: 'search',
    loadComponent: () =>
      import('./features/search/search.component').then((m) => m.SearchComponent),
  },
  { path: '**', redirectTo: 'hobby-desk' },
];
