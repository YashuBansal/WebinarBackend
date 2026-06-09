export class CreateAutomationFlowDto {
  name: string;
  status?: 'active' | 'inactive';
  flowType?: 'crm' | 'whatsapp';
  webinarId?: string;
  graph: any; // { nodes, edges }
}

export class UpdateAutomationFlowDto {
  name?: string;
  status?: 'active' | 'inactive';
  flowType?: 'crm' | 'whatsapp';
  webinarId?: string;
  graph?: any;
}
